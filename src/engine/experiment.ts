import { SimEngine, type EngineCounters } from "./engine";
import { buildSampleProject } from "../data/sampleLab";
import type { FirmwareProfileId } from "../registry/profiles";
import type { Flow, FlowResult, FlowVerdict, Provenance } from "./types";
import type { ProjectModel } from "./model";
import { ENGINE_VERSION } from "../storage/project";

export interface ExperimentConfig {
  id: string;
  name: string;
  notes: string;
  firmwareId: FirmwareProfileId;
  seed: number;
  policyBaseline: ProjectModel["sim"]["policyBaseline"];
  durationMs: number;
}

export interface MetricRow {
  metric: string;
  value: string | number;
  provenance: Provenance;
  how: string;
}

export interface ExperimentResult {
  config: ExperimentConfig;
  engineVersion: string;
  counters: EngineCounters;
  verdicts: Record<FlowVerdict, number>;
  flows: FlowResult[];
  totalCpuCost: number;
  totalAirtimeCost: number;
  ruleHits: { ruleId: string; hits: number }[];
  resource: ReturnType<SimEngine["resourceSnapshot"]>;
  startedAtMs: number;
  endedAtMs: number;
  eventCount: number;
}

export function configFromProject(project: ProjectModel, name: string): ExperimentConfig {
  return {
    id: `exp-${project.sim.firmwareId}-${project.sim.seed}`,
    name,
    notes: "",
    firmwareId: project.sim.firmwareId,
    seed: project.sim.seed,
    policyBaseline: project.sim.policyBaseline,
    durationMs: 600_000
  };
}

function cloneProject(project: ProjectModel): ProjectModel {
  return JSON.parse(JSON.stringify(project)) as ProjectModel;
}

export function runExperiment(
  baseProject: ProjectModel,
  config: ExperimentConfig,
  flows: Flow[],
  onEngine?: (engine: SimEngine) => void
): ExperimentResult {
  const project = cloneProject(baseProject);
  project.sim.firmwareId = config.firmwareId;
  project.sim.seed = config.seed;
  project.sim.policyBaseline = config.policyBaseline;
  if (config.firmwareId === "target-v1") {
    project.firewall.dialect = "stateful";
    project.firewall.defaultPolicy = "deny";
  } else if (config.firmwareId === "softap-sta") {
    project.firewall.dialect = "none";
  } else {
    project.firewall.dialect = "stock-4list";
    project.firewall.defaultPolicy = "allow";
  }
  const engine = new SimEngine(project);
  onEngine?.(engine);

  const startedAtMs = engine.now;
  const results: FlowResult[] = [];
  for (const flow of [...flows].sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id))) {
    if (flow.timestampMs > config.durationMs) break;
    engine.advanceTo(flow.timestampMs);
    results.push(engine.submitFlow(flow));
  }
  engine.advanceTo(Math.max(engine.now, config.durationMs));
  const endedAtMs = engine.now;

  const verdicts: Record<FlowVerdict, number> = { allowed: 0, denied: 0, dropped: 0, "not-enforceable": 0 };
  let totalCpuCost = 0;
  let totalAirtimeCost = 0;
  const ruleHitIds = new Set<string>();
  for (const result of results) {
    verdicts[result.verdict] += 1;
    totalCpuCost += result.cpuCost;
    totalAirtimeCost += result.airtimeCost;
    if (result.matchedRule) ruleHitIds.add(result.matchedRule);
  }
  for (const rule of project.firewall.rules) ruleHitIds.add(rule.id);

  return {
    config,
    engineVersion: ENGINE_VERSION,
    counters: { ...engine.counters },
    verdicts,
    flows: results,
    totalCpuCost: Math.round(totalCpuCost * 100) / 100,
    totalAirtimeCost: Math.round(totalAirtimeCost * 100) / 100,
    ruleHits: [...ruleHitIds]
      .map((ruleId) => ({ ruleId, hits: engine.ruleHitsFor(ruleId) }))
      .filter((row) => row.hits > 0)
      .sort((a, b) => b.hits - a.hits || a.ruleId.localeCompare(b.ruleId)),
    resource: engine.resourceSnapshot(),
    startedAtMs,
    endedAtMs,
    eventCount: engine.events.count
  };
}

export function runExperimentSuite(
  baseProject: ProjectModel,
  flows: Flow[],
  configs: ExperimentConfig[]
): ExperimentResult[] {
  return configs.map((config) => runExperiment(baseProject, config, flows));
}

export interface ComparisonRow {
  metric: string;
  provenance: Provenance;
  values: (string | number)[];
  delta: string;
}

export function compareResults(results: ExperimentResult[]): ComparisonRow[] {
  if (results.length < 2) return [];
  const rows: ComparisonRow[] = [];
  const add = (metric: string, provenance: Provenance, pick: (r: ExperimentResult) => number, suffix = "") => {
    const values = results.map(pick);
    const delta = values[values.length - 1] - values[0];
    rows.push({
      metric,
      provenance,
      values: values.map((v) => `${v}${suffix}`),
      delta: `${delta > 0 ? "+" : ""}${Math.round(delta * 100) / 100}${suffix}`
    });
  };
  add("flows", "measured", (r) => r.counters.flows);
  add("allowed", "measured", (r) => r.verdicts.allowed);
  add("denied", "measured", (r) => r.verdicts.denied);
  add("dropped", "measured", (r) => r.verdicts.dropped);
  add("not enforceable", "measured", (r) => r.verdicts["not-enforceable"]);
  add("total CPU cost", "estimate", (r) => r.totalCpuCost);
  add("total airtime cost", "estimate", (r) => r.totalAirtimeCost);
  add("peak CPU load", "estimate", (r) => r.resource.cpuLoadPct, "%");
  add("connections tracked", "measured", (r) => r.resource.conntrackUsed);
  rows.push({
    metric: "engine version",
    provenance: "measured",
    values: results.map((r) => r.engineVersion),
    delta: "—"
  });
  return rows;
}

export function defaultComparisonConfigs(project: ProjectModel): ExperimentConfig[] {
  const base = configFromProject(project, "baseline");
  return [
    { ...base, id: "cmp-stock-eth", name: "Stock — Ethernet uplink", firmwareId: "stock-eth" },
    { ...base, id: "cmp-stock-wifi", name: "Stock — Wi-Fi uplink", firmwareId: "stock-wifi" },
    { ...base, id: "cmp-target", name: "Target design v1", firmwareId: "target-v1" }
  ];
}

export function sampleProjectForExperiments(): ProjectModel {
  return buildSampleProject();
}

export function metricRows(result: ExperimentResult): MetricRow[] {
  return [
    {
      metric: "flows evaluated",
      value: result.counters.flows,
      provenance: "measured",
      how: "counted by the engine per submitted flow"
    },
    {
      metric: "verdicts",
      value: `allow ${result.verdicts.allowed} · deny ${result.verdicts.denied} · drop ${result.verdicts.dropped} · n/e ${result.verdicts["not-enforceable"]}`,
      provenance: "measured",
      how: "final pipeline verdict per flow"
    },
    {
      metric: "CPU cost",
      value: result.totalCpuCost,
      provenance: "estimate",
      how: "1.0 unit/flow Ethernet, 2.4 Wi-Fi uplink — engine constants, pending hardware calibration (M8)"
    },
    {
      metric: "airtime cost",
      value: result.totalAirtimeCost,
      provenance: "estimate",
      how: "0.5/0.8 routed, 1.0 L2 relay — relative airtime model, pending calibration (M8)"
    },
    {
      metric: "RAM used",
      value: `${result.resource.ramUsedKb} KB of ${result.resource.ramLimitKb} KB`,
      provenance: "estimate",
      how: "180 KB base + 0.2 KB/connection + 0.15 KB/NAPT mapping + 1.6 KB/queued buffer"
    },
    {
      metric: "conntrack",
      value: `${result.resource.conntrackUsed} of ${result.resource.conntrackCapacity}`,
      provenance: "measured",
      how: "connection table occupancy at the end of the run"
    },
    {
      metric: "rule hits",
      value: result.ruleHits.map((row) => `${row.ruleId}:${row.hits}`).join(", ") || "none",
      provenance: "measured",
      how: "incremented when a rule matches during evaluation"
    }
  ];
}
