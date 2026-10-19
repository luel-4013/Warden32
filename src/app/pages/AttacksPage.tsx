import { useState } from "react";
import { useApp } from "../store";
import { Chip, Empty, Pane, VERDICT_TONE, toneForLabel } from "../ui";
import { ATTACK_SCENARIOS, type AttackCategory, type AttackScenario } from "../../engine/attacks";
import type { SimEngine } from "../../engine/engine";
import type { FlowResult, FlowVerdict } from "../../engine/types";
import { FIRMWARE_PROFILES, type FirmwareProfileId } from "../../registry/profiles";

const CATEGORY_ORDER: AttackCategory[] = [
  "recon",
  "initial-access",
  "lateral",
  "c2",
  "exfiltration",
  "spoofing",
  "dos"
];

const CATEGORY_LABEL: Record<AttackCategory, string> = {
  recon: "reconnaissance",
  "initial-access": "initial access",
  lateral: "lateral movement",
  c2: "command & control",
  exfiltration: "exfiltration",
  spoofing: "spoofing",
  dos: "denial of service"
};

const VERDICT_ORDER: FlowVerdict[] = ["allowed", "denied", "dropped", "not-enforceable"];

interface ScenarioRuns {
  engine: SimEngine;
  byScenario: Record<string, FlowResult[]>;
}

export default function AttacksPage() {
  const app = useApp();
  const [runs, setRuns] = useState<ScenarioRuns | null>(null);
  const currentRuns = runs && runs.engine === app.engine ? runs.byScenario : {};

  const counts: Record<FlowVerdict, number> = { allowed: 0, denied: 0, dropped: 0, "not-enforceable": 0 };
  for (const result of app.results) counts[result.verdict] += 1;

  const run = (scenario: AttackScenario) => {
    const output = app.runAttack(scenario.id);
    setRuns((current) => {
      const byScenario =
        current && current.engine === app.engine
          ? { ...current.byScenario, [scenario.id]: output }
          : { [scenario.id]: output };
      return { engine: app.engine, byScenario };
    });
    app.setNotice(`${scenario.name}: ${output.length} flow(s) evaluated at engine time ${app.engine.now}ms`);
  };

  const switchFirmware = (id: FirmwareProfileId) => {
    if (id === app.project.sim.firmwareId) return;
    app.applyFirmware(id);
    app.setNotice(
      `firmware switched to ${FIRMWARE_PROFILES[id].name} — engine rebuilt and results cleared; re-run scenarios to compare stock vs target`
    );
  };

  return (
    <div className="page">
      <h2>attacks</h2>
      <div className="grid2">
        <Pane title="session summary" right={<span className="meta">{app.results.length} recorded flow(s)</span>}>
          <div className="row">
            {VERDICT_ORDER.map((verdict) => (
              <Chip key={verdict} tone={VERDICT_TONE[verdict]}>
                {verdict}: {counts[verdict]}
              </Chip>
            ))}
            <Chip tone={app.engine.incidents.openCount > 0 ? "warn" : "muted"}>
              {app.engine.incidents.openCount} active incident(s)
            </Chip>
          </div>
          <p className="meta" style={{ marginTop: 6 }}>
            counts cover the sample battery plus every scenario run since the last firmware switch or project change ·
            engine time {app.engine.now}ms · seed {app.project.sim.seed}
          </p>
        </Pane>
        <Pane title="firmware under test" right={<Chip tone="accent">{app.meta().firmwareName}</Chip>}>
          <p className="reason">
            switching firmware rebuilds the engine from the project and clears every recorded result — re-run scenarios
            afterwards to compare stock vs target outcomes side by side.
          </p>
          <div className="row" style={{ marginTop: 6 }}>
            {Object.values(FIRMWARE_PROFILES).map((profile) => (
              <button
                key={profile.id}
                className={profile.id === app.project.sim.firmwareId ? "primary" : ""}
                disabled={profile.id === app.project.sim.firmwareId}
                title={profile.name}
                onClick={() => switchFirmware(profile.id)}
              >
                {profile.id}
              </button>
            ))}
          </div>
          <p className="meta" style={{ marginTop: 6 }}>
            dialect: {app.project.firewall.dialect} · default policy: {app.project.firewall.defaultPolicy} ·{" "}
            {FIRMWARE_PROFILES[app.project.sim.firmwareId].note}
          </p>
        </Pane>
      </div>
      {CATEGORY_ORDER.map((category) => {
        const scenarios = ATTACK_SCENARIOS.filter((scenario) => scenario.category === category);
        return (
          <section key={category}>
            <h3>
              {CATEGORY_LABEL[category]} · {scenarios.length} scenario(s)
            </h3>
            <div className="grid2">
              {scenarios.map((scenario) => {
                const runResults = currentRuns[scenario.id] ?? null;
                return (
                  <article key={scenario.id} className="card">
                    <h4>
                      {scenario.name} <Chip tone="muted">{scenario.category}</Chip>{" "}
                      {scenario.modeled ? <Chip tone="ok">modeled</Chip> : <Chip tone="warn">not modeled</Chip>}{" "}
                      <Chip tone="muted" title="provenance of the modeled behavior">
                        {scenario.provenance}
                      </Chip>
                    </h4>
                    <div className="meta">
                      {scenario.id} · {scenario.description}
                    </div>
                    {scenario.modeled ? null : (
                      <div className="reason">
                        simulated: nothing — the run button is disabled and no flows are generated, because the
                        prerequisites for an honest model are absent.
                      </div>
                    )}
                    <div className="row" style={{ marginTop: 6 }}>
                      <button
                        disabled={!scenario.modeled}
                        title={
                          scenario.modeled
                            ? "build the scenario flows and evaluate them now"
                            : "not modeled — the lab will not fake this"
                        }
                        onClick={() => run(scenario)}
                      >
                        run
                      </button>
                      <span className="meta">
                        {runResults ? `${runResults.length} flow(s) in the last run` : "not run in this session"}
                      </span>
                    </div>
                    {runResults ? (
                      runResults.length === 0 ? (
                        <Empty text="no flows produced — prerequisites (devices) for this scenario are missing in the current project" />
                      ) : (
                        <div style={{ marginTop: 6 }}>
                          {runResults.map((result) => (
                            <div
                              key={result.flow.id}
                              style={{ borderTop: "1px solid var(--border)", paddingTop: 5, marginTop: 5 }}
                            >
                              <div className="row">
                                <span className="reason" style={{ flex: 1 }}>
                                  {result.flow.label}
                                </span>
                                <Chip tone={VERDICT_TONE[result.verdict]}>{result.verdict}</Chip>
                              </div>
                              <div className="meta">
                                {result.scope} · {result.enforcementPoint} · firewall sees:{" "}
                                {result.visibleToFirewall ? "yes" : "no"} · state: {result.connState ?? "—"} ·{" "}
                                {result.flow.protocol}
                                {result.flow.dstPort !== null ? `/${result.flow.dstPort}` : ""}
                              </div>
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
                            </div>
                          ))}
                        </div>
                      )
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
