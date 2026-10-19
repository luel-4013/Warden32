import { useState } from "react";
import { useApp } from "../store";
import { Chip, Empty, Pane, VERDICT_TONE } from "../ui";
import { buildSampleFlows } from "../../data/sampleLab";
import {
  configFromProject,
  defaultComparisonConfigs,
  metricRows,
  runExperiment,
  runExperimentSuite,
  type ExperimentConfig,
  type ExperimentResult
} from "../../engine/experiment";
import { experimentToCsv, experimentFileName, experimentToJson, experimentToMarkdown } from "../../storage/exports";
import { FIRMWARE_PROFILES, type FirmwareProfileId } from "../../registry/profiles";

const BASELINES: { id: ExperimentConfig["policyBaseline"]; label: string; description: string }[] = [
  {
    id: "P-A",
    label: "P-A — bare forwarding/NAT, no filtering",
    description: "P-A: bare forwarding/NAT with no filtering — the softap_sta minimal baseline, no management surface."
  },
  {
    id: "P-B",
    label: "P-B — stock stateless ACL, default-allow",
    description: "P-B: stock stateless 4-list IPv4 ACL, first-match, default-allow; non-IPv4 passes unfiltered (stock firmware profiles)."
  },
  {
    id: "P-C",
    label: "P-C — stateful default-deny + egress restriction",
    description: "P-C: stateful 5-tuple default-deny + egress allowlist — hypothetical custom firmware, not implemented on hardware."
  },
  {
    id: "P-D",
    label: "P-D — P-C + DNS sinkhole + full logging",
    description: "P-D: P-C plus DNS interception/sinkhole and full logging — hypothetical custom firmware, not implemented on hardware."
  }
];

type ExportKind = "json" | "csv" | "markdown";

export default function ExperimentsPage() {
  const app = useApp();
  const flows = buildSampleFlows();
  const [config, setConfig] = useState<ExperimentConfig>(() => configFromProject(app.project, "sample battery run"));
  const [run, setRun] = useState<ExperimentResult | null>(null);
  const [suite, setSuite] = useState<ExperimentResult[] | null>(null);

  const patch = (changes: Partial<ExperimentConfig>) => {
    setConfig((current) => ({ ...current, ...changes }));
  };

  const execute = () => {
    setRun(runExperiment(app.project, config, flows));
  };

  const executeSuite = () => {
    setSuite(runExperimentSuite(app.project, flows, defaultComparisonConfigs(app.project)));
  };

  const exportRun = (kind: ExportKind) => {
    if (!run) return;
    const extension = kind === "markdown" ? "md" : kind;
    const text = kind === "json" ? experimentToJson(run) : kind === "csv" ? experimentToCsv(run) : experimentToMarkdown(run);
    app.exportText(experimentFileName(run, extension), text);
  };

  const exportSuite = () => {
    if (!suite || suite.length === 0) return;
    const header = [
      "# Warden32 comparison suite",
      "",
      `- configs: ${suite
        .map((result) => `${result.config.name} (${result.config.firmwareId} · ${result.config.policyBaseline})`)
        .join("; ")}`,
      `- deterministic replay of the sample battery (${flows.length} flows) via runExperimentSuite — a simulation, not a hardware benchmark`,
      `- engine ${suite[0].engineVersion} · every estimate derives from engine calibration constants pending hardware validation (M8)`,
      ""
    ].join("\n");
    const body = suite.map(experimentToMarkdown).join("\n\n---\n\n");
    app.exportText("warden32-comparison-suite.md", `${header}\n${body}`);
  };

  const profile = FIRMWARE_PROFILES[config.firmwareId];
  const baseline = BASELINES.find((entry) => entry.id === config.policyBaseline);

  return (
    <div className="page">
      <h2>experiments — deterministic simulation</h2>
      <p className="meta">
        Every run replays the same {flows.length}-flow sample battery through a fresh engine built from a deep clone of
        the live project (cloneProject in engine/experiment.ts) — the live project and its engine are never mutated.
        Same seed and flows always produce identical output.
      </p>

      <Pane
        title="[1] experiment config (local — live project untouched)"
        right={
          <button onClick={() => setConfig(configFromProject(app.project, "sample battery run"))}>
            reset from project
          </button>
        }
      >
        <div className="grid2">
          <label className="control">
            name
            <input
              className="input"
              style={{ flex: 1 }}
              value={config.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <label className="control">
            firmware
            <select
              value={config.firmwareId}
              onChange={(event) => patch({ firmwareId: event.target.value as FirmwareProfileId })}
            >
              {Object.values(FIRMWARE_PROFILES).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="control">
            baseline
            <select
              value={config.policyBaseline}
              onChange={(event) => patch({ policyBaseline: event.target.value as ExperimentConfig["policyBaseline"] })}
            >
              {BASELINES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="control">
            seed
            <input
              className="input"
              type="number"
              value={config.seed}
              onChange={(event) => patch({ seed: Number(event.target.value) })}
            />
          </label>
          <label className="control">
            duration ms
            <input
              className="input"
              type="number"
              min={0}
              step={60000}
              value={config.durationMs}
              onChange={(event) => patch({ durationMs: Number(event.target.value) })}
            />
          </label>
          <label className="control">
            notes
            <input
              className="input"
              style={{ flex: 1 }}
              value={config.notes}
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </label>
        </div>
        <p className="meta">{baseline?.description}</p>
        <p className="meta">
          flows = {flows.length} (buildSampleFlows() — the sample battery; durationMs caps flow.timestampMs during the
          run) · config id {config.id}
        </p>
        <p className="meta">
          firmwareId selects the dialect inside runExperiment (target-v1 → stateful default-deny, softap-sta → no
          filtering, stock → 4-list ACL); the baseline label is carried into the result metadata.
        </p>
        <div className="labels">
          <Chip tone="muted">{profile.id}</Chip>
          <Chip tone="muted">{profile.uplink} uplink</Chip>
          {profile.implementedOnHardware ? (
            <Chip tone="ok">implemented on hardware</Chip>
          ) : (
            <Chip tone="warn">not implemented on hardware</Chip>
          )}
        </div>
      </Pane>

      <Pane title="[2] single run">
        <div className="row">
          <button className="primary" onClick={execute}>
            run experiment
          </button>
          <span className="meta">
            runExperiment(app.project, config, buildSampleFlows()) — deterministic replay; no live-project mutation (verified in engine/experiment.ts and engine/experiment.test.ts).
          </span>
        </div>
        {run === null ? (
          <Empty text="no experiment run yet — configure above and run" />
        ) : (
          <>
            <div className="row">
              <Chip tone="muted">engine {run.engineVersion}</Chip>
              <Chip tone="muted">
                window {run.startedAtMs}–{run.endedAtMs} ms
              </Chip>
              <Chip tone="muted">{run.eventCount} events</Chip>
              {(Object.entries(run.verdicts) as [keyof typeof VERDICT_TONE, number][]).map(([verdict, count]) => (
                <Chip key={verdict} tone={VERDICT_TONE[verdict]}>
                  {verdict}: {count}
                </Chip>
              ))}
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>metric</th>
                  <th>value</th>
                  <th>provenance</th>
                  <th>derived from</th>
                </tr>
              </thead>
              <tbody>
                {metricRows(run).map((row) => (
                  <tr key={row.metric}>
                    <td>{row.metric}</td>
                    <td>{row.value}</td>
                    <td>
                      <Chip tone="muted">{row.provenance}</Chip>
                    </td>
                    <td className="meta">{row.how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Pane>

      <Pane title="[3] comparison suite">
        <div className="row">
          <button onClick={executeSuite}>run comparison suite</button>
          <span className="meta">
            runExperimentSuite(app.project, buildSampleFlows(), defaultComparisonConfigs(app.project)) — stock Ethernet
            uplink (P-B), stock Wi-Fi uplink (P-B), target design v1 (P-C, not implemented on hardware).
          </span>
        </div>
        {suite === null ? (
          <Empty text="no suite run yet" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>config</th>
                <th>firmware</th>
                <th>baseline</th>
                <th>allowed</th>
                <th>denied</th>
                <th>dropped</th>
                <th>not enf.</th>
                <th>CPU cost</th>
                <th>airtime cost</th>
                <th>conntrack</th>
              </tr>
            </thead>
            <tbody>
              {suite.map((result) => (
                <tr key={result.config.id}>
                  <td>
                    {result.config.name}
                    <div className="meta">
                      rules: {result.ruleHits.map((row) => `${row.ruleId}:${row.hits}`).join(", ") || "none"}
                    </div>
                  </td>
                  <td className="meta">{result.config.firmwareId}</td>
                  <td>{result.config.policyBaseline}</td>
                  <td>{result.verdicts.allowed}</td>
                  <td>{result.verdicts.denied}</td>
                  <td>{result.verdicts.dropped}</td>
                  <td>{result.verdicts["not-enforceable"]}</td>
                  <td>
                    {result.totalCpuCost} <Chip tone="muted">estimate</Chip>
                  </td>
                  <td>
                    {result.totalAirtimeCost} <Chip tone="muted">estimate</Chip>
                  </td>
                  <td>
                    {result.resource.conntrackUsed} / {result.resource.conntrackCapacity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Pane>

      <Pane title="[4] exports — provenance travels with the artifact">
        <div className="row">
          <button disabled={!run} onClick={() => exportRun("json")}>
            experiment json
          </button>
          <button disabled={!run} onClick={() => exportRun("csv")}>
            experiment csv
          </button>
          <button disabled={!run} onClick={() => exportRun("markdown")}>
            experiment markdown
          </button>
          <button disabled={!suite} onClick={exportSuite}>
            suite markdown
          </button>
        </div>
        <p className="meta">
          Helpers: experimentToJson / experimentToCsv / experimentToMarkdown → experimentFileName. Markdown carries the
          per-metric provenance table; the suite file concatenates one section per config. All figures are
          deterministic simulation estimates from calibration constants — not measured hardware values.
        </p>
      </Pane>
    </div>
  );
}
