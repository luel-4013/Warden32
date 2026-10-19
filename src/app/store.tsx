import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildSampleFlows, buildSampleProject } from "../data/sampleLab";
import { SimEngine } from "../engine/engine";
import { attackById, runScenario, type AttackScenario } from "../engine/attacks";
import { runActivity as runActivityEngine, type ActivityMode, type ActivityReport } from "../engine/activity";
import type { FlowResult } from "../engine/types";
import type { FirmwareProfileId } from "../registry/profiles";
import { FIRMWARE_PROFILES } from "../registry/profiles";
import { parseProject, serializeProject } from "../storage/project";
import { loadAutosave, loadPrefs, readTextFile, saveAutosave, savePrefs, downloadText, slugify } from "../storage/persistence";

export type PageId =
  | "overview"
  | "topology"
  | "devices"
  | "activity"
  | "traffic"
  | "rules"
  | "attacks"
  | "incident"
  | "resources"
  | "experiments"
  | "compare"
  | "hardware"
  | "registry"
  | "docs";

export type RightTab = "inspect" | "rules" | "packets" | "console" | "attacks";

export interface AppStore {
  project: ReturnType<typeof buildSampleProject>;
  engine: SimEngine;
  results: FlowResult[];
  activity: ActivityReport | null;
  selectedId: string | null;
  setSelectedId(id: string | null): void;
  page: PageId;
  setPage(page: PageId): void;
  rightTab: RightTab;
  setRightTab(tab: RightTab): void;
  notice: string | null;
  setNotice(text: string | null): void;
  runSample(): FlowResult[];
  runAttack(id: string): FlowResult[];
  runActivity(mode: ActivityMode, windowMs: number, seed: number): ActivityReport | null;
  applyFirmware(id: FirmwareProfileId): void;
  setProject(mutate: (draft: ReturnType<typeof buildSampleProject>) => void, options?: { clearResults?: boolean }): void;
  replaceProject(next: ReturnType<typeof buildSampleProject>): void;
  saveFile(): void;
  openFile(): void;
  openFromBrowserFile(browserFile: File): Promise<void>;
  exportText(name: string, text: string): void;
  meta(): { name: string; firmwareName: string };
}

const StoreContext = createContext<AppStore | null>(null);

const PAGE_IDS: PageId[] = [
  "overview",
  "topology",
  "devices",
  "activity",
  "traffic",
  "rules",
  "attacks",
  "incident",
  "resources",
  "experiments",
  "compare",
  "hardware",
  "registry",
  "docs"
];

function initialPage(): PageId {
  if (typeof window === "undefined") return "topology";
  const requested = new URLSearchParams(window.location.search).get("page");
  return requested && (PAGE_IDS as string[]).includes(requested) ? (requested as PageId) : "topology";
}

function activityDeepLink(): { mode: ActivityMode; windowMs: number } | null {
  if (typeof window === "undefined") return null;
  const runParam = new URLSearchParams(window.location.search).get("run");
  const mode: ActivityMode | null =
    runParam === "activity-compromised"
      ? "compromised"
      : runParam === "activity-normal"
        ? "normal"
        : runParam === "activity"
          ? "states"
          : null;
  return mode === null ? null : { mode, windowMs: 3_600_000 };
}

export function initialActivityMode(): ActivityMode {
  return activityDeepLink()?.mode ?? "states";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [project, setProjectState] = useState(() => {
    const saved = loadAutosave();
    if (saved) {
      const parsed = parseProject(saved);
      if (parsed.ok && parsed.project) return parsed.project;
    }
    return buildSampleProject();
  });
  const engine = useMemo(() => new SimEngine(clone(project)), [project]);
  const [results, setResults] = useState<FlowResult[]>([]);
  const [activity, setActivity] = useState<ActivityReport | null>(() => {
    const deep = activityDeepLink();
    if (deep === null) return null;
    const candidates = project.devices.filter(
      (device) => device.role === "iot" && !device.isRouter && !device.gateway && ["guest", "trusted", "mgmt"].includes(device.zone)
    );
    if (candidates.length === 0) return null;
    return runActivityEngine(engine, project, { mode: deep.mode, windowMs: deep.windowMs, seed: project.sim.seed });
  });
  const [selectedId, setSelectedId] = useState<string | null>("esp32");
  const [page, setPage] = useState<PageId>(initialPage);
  const [rightTab, setRightTab] = useState<RightTab>(() => (activityDeepLink() !== null ? "console" : "inspect"));
  const [notice, setNoticeState] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const setNotice = useCallback((text: string | null) => setNoticeState(text), []);

  useEffect(() => {
    saveAutosave(serializeProject(project));
    savePrefs({ ...loadPrefs(), recentProjectName: project.meta.name });
  }, [project]);

  const runSample = useCallback((): FlowResult[] => {
    const output = buildSampleFlows().map((flow) => engine.submitFlow(flow));
    setResults(output);
    setRightTab("packets");
    return output;
  }, [engine]);

  const runAttack = useCallback(
    (id: string): FlowResult[] => {
      const scenario: AttackScenario | null = attackById(id);
      if (!scenario) return [];
      const output = runScenario(engine, scenario);
      setResults((current) => [...current, ...output]);
      setRightTab("packets");
      return output;
    },
    [engine]
  );

  const runActivity = useCallback(
    (mode: ActivityMode, windowMs: number, seed: number): ActivityReport | null => {
      const candidates = project.devices.filter(
        (device) => device.role === "iot" && !device.isRouter && !device.gateway && ["guest", "trusted", "mgmt"].includes(device.zone)
      );
      if (candidates.length === 0) {
        setNotice("no IoT devices in managed zones — add a device first (devices page)");
        return null;
      }
      const report = runActivityEngine(engine, project, { mode, windowMs, seed });
      setActivity(report);
      setRightTab("console");
      setNotice(
        `activity run · ${report.totals.flows} flow(s) · ${(report.totals.bytesAttempted / 1_000_000).toFixed(2)} MB attempted · mode ${mode}`
      );
      return report;
    },
    [engine, project, setNotice]
  );

  const applyFirmware = useCallback((firmwareId: FirmwareProfileId) => {
    setProjectState((current) => {
      const next = clone(current);
      next.sim.firmwareId = firmwareId;
      if (firmwareId === "target-v1") {
        next.firewall.dialect = "stateful";
        next.firewall.defaultPolicy = "deny";
        next.sim.policyBaseline = "P-C";
      } else if (firmwareId === "softap-sta") {
        next.firewall.dialect = "none";
        next.firewall.defaultPolicy = "allow";
        next.sim.policyBaseline = "P-A";
      } else {
        next.firewall.dialect = "stock-4list";
        next.firewall.defaultPolicy = "allow";
        next.sim.policyBaseline = "P-B";
      }
      return next;
    });
    setResults([]);
    setActivity(null);
  }, []);

  const setProject = useCallback(
    (mutate: (draft: ReturnType<typeof buildSampleProject>) => void, options?: { clearResults?: boolean }) => {
      setProjectState((current) => {
        const next = clone(current);
        mutate(next);
        return next;
      });
      if (options?.clearResults) {
        setResults([]);
        setActivity(null);
      }
    },
    []
  );

  const replaceProject = useCallback((next: ReturnType<typeof buildSampleProject>) => {
    setProjectState(next);
    setResults([]);
    setActivity(null);
    setSelectedId("esp32");
  }, []);

  const openFromBrowserFile = useCallback(
    async (browserFile: File) => {
      const parsed = parseProject(await readTextFile(browserFile));
      if (!parsed.ok || !parsed.project) {
        setNotice(`open failed: ${parsed.errors.join("; ")}`);
        return;
      }
      replaceProject(parsed.project);
      setNotice(
        `opened "${parsed.project.meta.name}"${parsed.warnings.length > 0 ? ` · ${parsed.warnings.length} warning(s)` : ""}`
      );
    },
    [replaceProject, setNotice]
  );

  const saveFile = useCallback(() => {
    downloadText(`${slugify(project.meta.name)}.warden32`, serializeProject(project));
    setNotice(`saved ${slugify(project.meta.name)}.warden32`);
  }, [project, setNotice]);

  const openFile = useCallback(() => fileInput.current?.click(), []);

  const exportText = useCallback(
    (name: string, text: string) => {
      downloadText(name, text);
      setNotice(`exported ${name}`);
    },
    [setNotice]
  );

  const meta = useCallback(
    () => ({ name: project.meta.name, firmwareName: FIRMWARE_PROFILES[project.sim.firmwareId].name }),
    [project]
  );

  useEffect(() => {
    const onDragOver = (event: DragEvent) => event.preventDefault();
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      const browserFile = event.dataTransfer?.files[0];
      if (browserFile) void openFromBrowserFile(browserFile);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [openFromBrowserFile]);

  const store: AppStore = {
    project,
    engine,
    results,
    activity,
    selectedId,
    setSelectedId,
    page,
    setPage,
    rightTab,
    setRightTab,
    notice,
    setNotice,
    runSample,
    runAttack,
    runActivity,
    applyFirmware,
    setProject,
    replaceProject,
    saveFile,
    openFile,
    openFromBrowserFile,
    exportText,
    meta
  };

  return (
    <StoreContext.Provider value={store}>
      {children}
      <input
        ref={fileInput}
        type="file"
        accept=".warden32,.json,application/json"
        style={{ display: "none" }}
        onChange={(event) => {
          const browserFile = event.target.files?.[0];
          if (browserFile) void openFromBrowserFile(browserFile);
          event.target.value = "";
        }}
      />
    </StoreContext.Provider>
  );
}

export function useApp(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useApp must be used inside AppStoreProvider");
  return store;
}
