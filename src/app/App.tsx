import { useState } from "react";
import { AppStoreProvider, useApp, type PageId, type RightTab } from "./store";
import { CATEGORY_TONE, Chip, VERDICT_TONE, toneForLabel } from "./ui";
import { PageIcon } from "./icons";
import { TopologyCanvas } from "./components/TopologyCanvas";
import { Inspector } from "./components/Inspector";
import { ATTACK_SCENARIOS } from "../engine/attacks";
import { ENGINE_VERSION } from "../storage/project";
import { buildSampleProject } from "../data/sampleLab";
import { loadPrefs, savePrefs } from "../storage/persistence";
import { FIRMWARE_PROFILES, type FirmwareProfileId } from "../registry/profiles";
import OverviewPage from "./pages/OverviewPage";
import DevicesPage from "./pages/DevicesPage";
import ActivityPage from "./pages/ActivityPage";
import RulesPage from "./pages/RulesPage";
import TrafficPage from "./pages/TrafficPage";
import AttacksPage from "./pages/AttacksPage";
import IncidentPage from "./pages/IncidentPage";
import ResourcesPage from "./pages/ResourcesPage";
import ExperimentsPage from "./pages/ExperimentsPage";
import ComparePage from "./pages/ComparePage";
import HardwarePage from "./pages/HardwarePage";
import RegistryPage from "./pages/RegistryPage";
import DocsPage from "./pages/DocsPage";

const PAGES: { id: PageId; label: string }[] = [
  { id: "overview", label: "overview" },
  { id: "topology", label: "topology" },
  { id: "devices", label: "devices" },
  { id: "activity", label: "activity" },
  { id: "traffic", label: "traffic" },
  { id: "rules", label: "rules" },
  { id: "attacks", label: "attacks" },
  { id: "incident", label: "incident" },
  { id: "resources", label: "resources" },
  { id: "experiments", label: "experiments" },
  { id: "compare", label: "compare" },
  { id: "hardware", label: "hardware" },
  { id: "registry", label: "registry" },
  { id: "docs", label: "docs" }
];

function PageBody() {
  const { page } = useApp();
  switch (page) {
    case "overview":
      return <OverviewPage />;
    case "topology":
      return <TopologyCanvas />;
    case "devices":
      return <DevicesPage />;
    case "activity":
      return <ActivityPage />;
    case "traffic":
      return <TrafficPage />;
    case "rules":
      return <RulesPage />;
    case "attacks":
      return <AttacksPage />;
    case "incident":
      return <IncidentPage />;
    case "resources":
      return <ResourcesPage />;
    case "experiments":
      return <ExperimentsPage />;
    case "compare":
      return <ComparePage />;
    case "hardware":
      return <HardwarePage />;
    case "registry":
      return <RegistryPage />;
    case "docs":
      return <DocsPage />;
    default:
      return <OverviewPage />;
  }
}

function Explorer() {
  const { project, selectedId, setSelectedId, setRightTab } = useApp();
  return (
    <aside className="explorer">
      <div className="wtitle">EXPLORER</div>
      <div className="tree scroll">
        {project.zones.map((zone) => {
          const devices = project.devices.filter((device) => device.zone === zone.id);
          return (
            <div key={zone.id}>
              <div className="tree-h">{zone.name}</div>
              {devices.map((device) => (
                <button
                  key={device.id}
                  className={`tree-i ${device.id === selectedId ? "on" : ""}`}
                  onClick={() => {
                    setSelectedId(device.id);
                    setRightTab("inspect");
                  }}
                >
                  {device.name}
                  {device.isRouter ? " ⌂" : ""}
                  {device.compromised ? " ⚠" : ""}
                  {device.quarantined ? " ⛔" : ""}
                </button>
              ))}
              {devices.length === 0 ? <div className="tree-i meta">—</div> : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function ResultsLog() {
  const { results } = useApp();
  if (results.length === 0) return <p className="meta">no flows evaluated yet</p>;
  return (
    <>
      {results.map((result) => (
        <article key={`${result.flow.id}-${result.events[0]?.id ?? 0}`} className="card">
          <h4>
            {result.flow.label} <Chip tone={VERDICT_TONE[result.verdict]}>{result.verdict}</Chip>{" "}
            <Chip>{result.flow.kind}</Chip>
          </h4>
          <div className="meta">
            {result.scope} · {result.enforcementPoint} · firewall sees: {result.visibleToFirewall ? "yes" : "no"} ·
            state: {result.connState ?? "—"}
          </div>
          {result.natChain.length > 0 ? (
            <div className="natchain">
              {result.natChain.map((hop) => `${hop.hostName}: ${hop.toIp}:${hop.toPort ?? "*"}`).join(" → ")}
            </div>
          ) : null}
          {result.matchedRule ? <div className="meta">matched: {result.matchedRule}</div> : null}
          <div className="reason">{result.reason}</div>
          {result.labels.length > 0 ? (
            <div className="labels">
              {result.labels.map((label) => (
                <Chip key={label} tone={toneForLabel(label)}>
                  {label}
                </Chip>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </>
  );
}

function ConsoleLog() {
  const { engine, results } = useApp();
  const events = [...engine.events.all].slice(-250).reverse();
  return (
    <>
      <p className="meta">event stream · {engine.events.count} total · newest first</p>
      {events.length === 0 ? <p className="meta">no events yet</p> : null}
      {events.map((event) => (
        <div key={event.id} className="row" style={{ gap: 6, marginBottom: 3 }}>
          <Chip tone={CATEGORY_TONE[event.category] ?? ""}>{event.category}</Chip>
          <span className="meta" style={{ minWidth: 54 }}>
            {event.ts}ms
          </span>
          <span className="reason" style={{ flex: 1 }}>
            {event.message}
          </span>
          <Chip tone="muted">{event.provenance}</Chip>
        </div>
      ))}
      {results.length === 0 ? null : <p className="meta">— end of {results.length} flow(s) —</p>}
    </>
  );
}

function CompactRules() {
  const { project, engine, results } = useApp();
  return (
    <>
      <p className="meta">
        dialect: {project.firewall.dialect} · default: {project.firewall.defaultPolicy}
      </p>
      {project.firewall.rules.map((rule) => (
        <div key={rule.id} className="card">
          <h4>
            {rule.name} <Chip tone={rule.enabled ? "ok" : "muted"}>{rule.enabled ? "on" : "off"}</Chip>{" "}
            <Chip>{rule.action}</Chip>
          </h4>
          <div className="meta">
            {rule.protocol} · {rule.src} → {rule.dst} · hits: {engine.ruleHitsFor(rule.id)}
            {rule.rateLimitPerSec ? ` · limit ${rule.rateLimitPerSec}/s` : ""}
          </div>
          {rule.description ? <div className="meta">{rule.description}</div> : null}
        </div>
      ))}
      {project.firewall.rules.length === 0 ? (
        <p className="meta">no stateful rules — stock dialect uses the 4-list ACL (edit on the rules page)</p>
      ) : null}
      <p className="meta">flows evaluated: {results.length}</p>
    </>
  );
}

function AttacksTab() {
  const { runAttack } = useApp();
  return (
    <>
      {ATTACK_SCENARIOS.map((scenario) => (
        <div key={scenario.id} className="card">
          <h4>
            {scenario.name} <Chip>{scenario.category}</Chip>{" "}
            {scenario.modeled ? null : <Chip tone="muted">not modeled</Chip>}
          </h4>
          <div className="meta">{scenario.description}</div>
          <div className="row" style={{ marginTop: 6 }}>
            <button disabled={!scenario.modeled} onClick={() => runAttack(scenario.id)}>
              run
            </button>
            <Chip tone="muted">{scenario.provenance}</Chip>
          </div>
        </div>
      ))}
    </>
  );
}

function RightPane() {
  const { rightTab, setRightTab, selectedId, project, engine, results } = useApp();
  const selected = project.devices.find((device) => device.id === selectedId) ?? null;
  const tabs: { id: RightTab; label: string; hint: string; icon: PageId }[] = [
    { id: "inspect", label: "inspect", hint: "device details", icon: "topology" },
    { id: "rules", label: "rules.fw", hint: "firewall rules", icon: "rules" },
    { id: "packets", label: "packets.log", hint: "flow results", icon: "traffic" },
    { id: "console", label: "console", hint: "event stream", icon: "registry" },
    { id: "attacks", label: "attacks", hint: "scenario runner", icon: "attacks" }
  ];
  const active = tabs.find((tab) => tab.id === rightTab) ?? tabs[0];
  const context =
    rightTab === "inspect"
      ? selected?.name ?? "nothing selected"
      : rightTab === "rules"
        ? `dialect ${project.firewall.dialect} · ${project.firewall.rules.length} rules`
        : rightTab === "packets"
          ? `${results.length} flow(s)`
          : rightTab === "console"
            ? `${engine.events.count} events`
            : `${ATTACK_SCENARIOS.filter((s) => s.modeled).length}/${ATTACK_SCENARIOS.length} modeled`;
  return (
    <aside className="right">
      <div className="tabs">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            className={`tab ${rightTab === tab.id ? "on" : ""}`}
            title={`[${index + 1}] ${tab.label} — ${tab.hint}`}
            onClick={() => setRightTab(tab.id)}
          >
            <PageIcon id={tab.icon} />
            <span className="tab-n">{index + 1}</span>
          </button>
        ))}
      </div>
      <div className="pane-h">
        <b>
          [{tabs.findIndex((tab) => tab.id === rightTab) + 1}] {active.label}
        </b>{" "}
        · {context}
      </div>
      <section className="pane grow">
        <div className="pane-scroll scroll">
          {rightTab === "inspect" ? <Inspector device={selected} /> : null}
          {rightTab === "rules" ? <CompactRules /> : null}
          {rightTab === "packets" ? <ResultsLog /> : null}
          {rightTab === "console" ? <ConsoleLog /> : null}
          {rightTab === "attacks" ? <AttacksTab /> : null}
        </div>
      </section>
    </aside>
  );
}

function Shell() {
  const app = useApp();
  const [railOpen, setRailOpen] = useState(() => loadPrefs().railOpen ?? false);
  const toggleRail = () => {
    setRailOpen((open) => {
      const next = !open;
      savePrefs({ ...loadPrefs(), railOpen: next });
      return next;
    });
  };
  return (
    <div className={`app ${railOpen ? "rail-open" : ""}`}>
      <header className="top">
        <span className="brand">WARDEN32</span>
        <span className="brand-sub">{app.project.meta.name}</span>
        <span className="spacer" />
        <button onClick={() => app.replaceProject(buildSampleProject())}>new</button>
        <button onClick={app.openFile}>open</button>
        <button onClick={app.saveFile}>save</button>
        <label className="control">
          firmware
          <select value={app.project.sim.firmwareId} onChange={(event) => app.applyFirmware(event.target.value as FirmwareProfileId)}>
            {Object.values(FIRMWARE_PROFILES).map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" onClick={() => app.runSample()}>
          run battery
        </button>
      </header>
      {app.notice ? (
        <div className="notice">
          {app.notice}
          <button className="notice-close" onClick={() => app.setNotice(null)}>
            ✕
          </button>
        </div>
      ) : null}
      <div className="ide-body">
        <nav className="activity">
          {PAGES.map((page) => (
            <button
              key={page.id}
              title={page.label}
              className={app.page === page.id ? "on" : ""}
              onClick={() => app.setPage(page.id)}
            >
              <PageIcon id={page.id} />
              <span className="lbl">{page.label}</span>
            </button>
          ))}
          <button className="rail-toggle" title={railOpen ? "collapse rail" : "expand rail"} onClick={toggleRail}>
            {railOpen ? "«" : "»"}
          </button>
        </nav>
        <Explorer />
        <main className="center">
          <div className="tabs">
            {PAGES.map((page) => (
              <button
                key={page.id}
                className={`tab ${app.page === page.id ? "on" : ""}`}
                onClick={() => app.setPage(page.id)}
              >
                {page.label}
              </button>
            ))}
          </div>
          <div className="center-body scroll">
            <PageBody />
          </div>
        </main>
        <RightPane />
      </div>
      <footer className="statusbar accent">
        <span>{app.meta().firmwareName}</span>
        <span>baseline {app.project.sim.policyBaseline}</span>
        <span>acl {app.project.firewall.dialect}</span>
        <span>seed {app.project.sim.seed}</span>
        <span>nodes {app.project.devices.length}</span>
        <span>link {app.engine.adapter.name}</span>
        <span>engine {ENGINE_VERSION} · deterministic</span>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AppStoreProvider>
      <Shell />
    </AppStoreProvider>
  );
}
