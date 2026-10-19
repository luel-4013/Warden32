import type { ExperimentResult } from "../engine/experiment";
import { metricRows } from "../engine/experiment";
import { slugify } from "./persistence";

export function experimentToJson(result: ExperimentResult): string {
  return JSON.stringify(
    {
      kind: "warden32.experiment",
      engineVersion: result.engineVersion,
      config: result.config,
      counters: result.counters,
      verdicts: result.verdicts,
      totals: { cpuCost: result.totalCpuCost, airtimeCost: result.totalAirtimeCost },
      resource: result.resource,
      ruleHits: result.ruleHits,
      timeline: { startedAtMs: result.startedAtMs, endedAtMs: result.endedAtMs, eventCount: result.eventCount },
      flows: result.flows.map((flow) => ({
        id: flow.flow.id,
        label: flow.flow.label,
        kind: flow.flow.kind,
        timestampMs: flow.flow.timestampMs,
        src: flow.flow.srcDeviceId,
        dst: flow.flow.dstDeviceId,
        protocol: flow.flow.protocol,
        srcPort: flow.flow.srcPort,
        dstPort: flow.flow.dstPort,
        verdict: flow.verdict,
        scope: flow.scope,
        visibleToFirewall: flow.visibleToFirewall,
        enforcementPoint: flow.enforcementPoint,
        matchedRule: flow.matchedRule,
        connState: flow.connState,
        route: flow.route,
        reason: flow.reason,
        natChain: flow.natChain.map(
          (hop) => `${hop.hostName}: ${hop.fromIp}:${hop.fromPort ?? "*"} → ${hop.toIp}:${hop.toPort ?? "*"}`
        ),
        labels: flow.labels
      }))
    },
    null,
    2
  );
}

const CSV_HEADER = [
  "flow_id",
  "label",
  "kind",
  "timestamp_ms",
  "src_device",
  "dst_device",
  "protocol",
  "src_port",
  "dst_port",
  "verdict",
  "scope",
  "visible_to_firewall",
  "enforcement_point",
  "matched_rule",
  "conn_state",
  "route",
  "nat_hops",
  "labels",
  "reason"
];

function csvCell(value: string | number | null | boolean): string {
  const text = value === null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function experimentToCsv(result: ExperimentResult): string {
  const lines = [CSV_HEADER.join(",")];
  for (const flow of result.flows) {
    lines.push(
      [
        flow.flow.id,
        flow.flow.label,
        flow.flow.kind,
        flow.flow.timestampMs,
        flow.flow.srcDeviceId,
        flow.flow.dstDeviceId,
        flow.flow.protocol,
        flow.flow.srcPort,
        flow.flow.dstPort,
        flow.verdict,
        flow.scope,
        flow.visibleToFirewall,
        flow.enforcementPoint,
        flow.matchedRule,
        flow.connState,
        flow.route,
        flow.natChain
          .map((hop) => `${hop.hostName}:${hop.fromIp}:${hop.fromPort ?? "*"}->${hop.toIp}:${hop.toPort ?? "*"}`)
          .join(" | "),
        flow.labels.join(" | "),
        flow.reason
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\n");
}

export function experimentToMarkdown(result: ExperimentResult): string {
  const lines: string[] = [];
  lines.push(`# Warden32 experiment — ${result.config.name}`);
  lines.push("");
  lines.push(`- Firmware: ${result.config.firmwareId}`);
  lines.push(`- Seed: ${result.config.seed} · baseline: ${result.config.policyBaseline}`);
  lines.push(`- Engine version: ${result.engineVersion}`);
  lines.push(`- Window: ${result.startedAtMs}–${result.endedAtMs} ms (${result.eventCount} events)`);
  lines.push("");
  lines.push("## Traceable metrics");
  lines.push("");
  lines.push("| metric | value | provenance | derived from |");
  lines.push("| --- | --- | --- | --- |");
  for (const row of metricRows(result)) {
    lines.push(`| ${row.metric} | ${row.value} | ${row.provenance} | ${row.how} |`);
  }
  lines.push("");
  lines.push("## Verdicts");
  lines.push("");
  lines.push("| flow | src → dst | ports | verdict | matched | reason |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const flow of result.flows) {
    const ports = `${flow.flow.srcPort ?? "*"}→${flow.flow.dstPort ?? "*"}`;
    lines.push(
      `| ${flow.flow.label} | ${flow.flow.srcDeviceId} → ${flow.flow.dstDeviceId} | ${ports} | ${flow.verdict} | ${
        flow.matchedRule ?? "—"
      } | ${flow.reason.replace(/\|/g, "/")} |`
    );
  }
  lines.push("");
  lines.push("_wc: every number above carries a provenance tag; `estimate` values await hardware calibration._");
  return lines.join("\n");
}

export function experimentFileName(result: ExperimentResult, extension: string): string {
  return `${slugify(`warden32-${result.config.name}`)}.${extension}`;
}
