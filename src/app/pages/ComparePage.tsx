import { useState } from "react";
import { useApp } from "../store";
import { Chip, Empty, Pane, type Tone } from "../ui";
import { buildSampleFlows } from "../../data/sampleLab";
import {
  compareResults,
  defaultComparisonConfigs,
  runExperimentSuite,
  type ExperimentResult
} from "../../engine/experiment";
import { experimentToMarkdown } from "../../storage/exports";

const READING: Record<string, { better: "lower" | "higher" | "none"; note: string }> = {
  flows: { better: "none", note: "the identical sample battery is replayed for every config" },
  allowed: { better: "lower", note: "lower = fewer flows pass without policy action (containment of uncontrolled traffic)" },
  denied: { better: "higher", note: "higher = more traffic explicitly enforced by policy; review false positives" },
  dropped: { better: "none", note: "drops mix policy enforcement and failures — inspect per-flow reasons in the run" },
  "not enforceable": { better: "lower", note: "lower = fewer frames the firewall cannot see at all (L2 relay)" },
  "total CPU cost": { better: "lower", note: "lower = less estimated CPU demand on the ESP32" },
  "total airtime cost": { better: "lower", note: "lower = less estimated radio airtime shared with the uplink" },
  "peak CPU load": { better: "lower", note: "lower = less estimated saturation inside the 1 s window" },
  "connections tracked": { better: "lower", note: "lower = smaller live state held in the ESP32 heap" },
  "engine version": { better: "none", note: "same deterministic engine for every config" }
};

function readingFor(metric: string, delta: string): { tone: Tone; label: string; note: string } {
  const rule = READING[metric];
  const numeric = Number.parseFloat(delta);
  if (!rule || rule.better === "none" || Number.isNaN(numeric) || numeric === 0) {
    return { tone: "muted", label: "neutral", note: rule?.note ?? "no directional reading for this metric" };
  }
  const better = (rule.better === "lower" && numeric < 0) || (rule.better === "higher" && numeric > 0);
  return { tone: better ? "ok" : "warn", label: better ? "better" : "worse", note: rule.note };
}

export default function ComparePage() {
  const app = useApp();
  const flows = buildSampleFlows();
  const [suite, setSuite] = useState<ExperimentResult[] | null>(null);

  const runSuite = () => {
    setSuite(runExperimentSuite(app.project, flows, defaultComparisonConfigs(app.project)));
  };

  const exportSuite = () => {
    if (!suite || suite.length === 0) return;
    const header = [
      "# Warden32 comparison suite",
      "",
      `- configs: ${suite
        .map((result) => `${result.config.name} (${result.config.firmwareId} · ${result.config.policyBaseline})`)
        .join("; ")}`,
      `- deterministic replay of the sample battery (${flows.length} flows) via runExperimentSuite(defaultComparisonConfigs)`,
      "- all figures are engine simulation estimates from calibration constants (DEFAULT_CALIBRATION, provenance: estimate) unless tagged measured; pending hardware validation (M8) — not a hardware benchmark",
      "- delta orientation: last config − first config",
      ""
    ].join("\n");
    const body = suite.map(experimentToMarkdown).join("\n\n---\n\n");
    app.exportText("warden32-comparison-suite.md", `${header}\n${body}`);
  };

  const rows = suite ? compareResults(suite) : [];

  return (
    <div className="page">
      <h2>policy comparison — deterministic suite</h2>
      <p className="meta">
        One click replays the {flows.length}-flow sample battery through stock Ethernet, stock Wi-Fi and the target
        design on fresh cloned engines; the live project is never touched. Results are deterministic — same inputs,
        same output, every time.
      </p>
      <div className="row">
        <button className="primary" onClick={runSuite}>
          run suite
        </button>
        <button disabled={!suite} onClick={exportSuite}>
          export suite markdown
        </button>
        <span className="meta">runExperimentSuite(defaultComparisonConfigs()) · no hardware measurements involved</span>
      </div>

      <Pane title="[metric comparison]">
        {suite === null ? (
          <Empty text="no suite run yet — run it to compare stock Ethernet, stock Wi-Fi and the target design" />
        ) : rows.length === 0 ? (
          <Empty text="suite returned fewer than two results — nothing to compare" />
        ) : (
          <>
            <p className="meta">
              delta = last config − first config ({suite[suite.length - 1].config.name} − {suite[0].config.name});
              reading is computed from the delta sign only, with per-metric direction listed below.
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>metric</th>
                  {suite.map((result) => (
                    <th key={result.config.id}>
                      {result.config.name}
                      <div className="meta">
                        {result.config.firmwareId} · {result.config.policyBaseline}
                      </div>
                    </th>
                  ))}
                  <th>delta</th>
                  <th>reading</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const reading = readingFor(row.metric, row.delta);
                  return (
                    <tr key={row.metric}>
                      <td>
                        {row.metric}
                        <div className="meta">
                          <Chip tone="muted">{row.provenance}</Chip>
                        </div>
                      </td>
                      {row.values.map((value, index) => (
                        <td key={index}>{value}</td>
                      ))}
                      <td>{row.delta}</td>
                      <td>
                        <Chip tone={reading.tone} title={reading.note}>
                          {reading.label}
                        </Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="meta">
              "denied" rising is a win for enforcement but can also mean false positives — inspect the per-flow reasons
              on the experiments page before drawing conclusions.
            </p>
          </>
        )}
      </Pane>

      <Pane title="[baselines & provenance]">
        <div className="grid3">
          <div className="card">
            <h4>
              P-A <Chip tone="muted">baseline</Chip>
            </h4>
            <div className="meta">
              Bare forwarding/NAT with no filtering — the esp-idf softap_sta minimal profile. Not part of this suite.
            </div>
          </div>
          <div className="card">
            <h4>
              P-B <Chip tone="warn">stock</Chip>
            </h4>
            <div className="meta">
              Stock stateless 4-list IPv4 ACL, first-match, default-allow; non-IPv4 passes unfiltered and the Wi-Fi
              driver relays guest frames without isolation.
            </div>
          </div>
          <div className="card">
            <h4>
              P-C <Chip tone="accent">target</Chip>
            </h4>
            <div className="meta">
              Stateful 5-tuple default-deny plus egress allowlist (target design v1). Hypothetical — labelled not
              implemented on hardware everywhere.
            </div>
          </div>
        </div>
        <p className="meta">
          P-D (defined in the build spec) adds DNS sinkhole + full logging on top of P-C. This suite runs three configs:
          stock Ethernet uplink (P-B), stock Wi-Fi uplink (P-B, receive-then-forward half-duplex penalty) and target
          design v1 (P-C).
        </p>
        <p className="meta">
          Everything below is a deterministic simulation estimate from the engine's calibration constants
          (DEFAULT_CALIBRATION, provenance: <Chip tone="muted">estimate</Chip>); topology premises carry{" "}
          <Chip tone="muted">assumption</Chip> provenance. Nothing here is a measured hardware value — validation is
          pending (M8).
        </p>
      </Pane>
    </div>
  );
}
