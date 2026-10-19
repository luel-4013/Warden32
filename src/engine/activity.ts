import { activityBehaviorFor, FIRMWARE_THROUGHPUT_ESTIMATE_MBPS, type ActivityBehavior } from "../registry/activity";
import type { SimEngine } from "./engine";
import type { DeviceModel, ProjectModel, ZoneId } from "./model";
import { mulberry32 } from "./rng";
import { seedFor } from "./traffic";
import type { Flow, FlowResult } from "./types";

export type ActivityMode = "states" | "normal" | "compromised";

export interface ActivityOptions {
  windowMs: number;
  seed: number;
  mode: ActivityMode;
  maxPerActivity?: number;
}

export interface ActivityFlow extends Flow {
  bytes: number;
  sampleOf: number;
  activityId: string;
  activityLabel: string;
  activityTargetKind: string;
}

export interface ActivityLine {
  activityId: string;
  label: string;
  targetDeviceId: string;
  flows: number;
  bytes: number;
  allowedBytes: number;
}

export interface ActivityDeviceSummary {
  deviceId: string;
  name: string;
  zone: ZoneId;
  profileId: string;
  state: "normal" | "compromised";
  demandMbps: number;
  capMbps: number | null;
  overCap: boolean;
  offline: boolean;
  flows: number;
  allowed: number;
  denied: number;
  dropped: number;
  notEnforceable: number;
  bytesAttempted: number;
  bytesAllowed: number;
  bytesReceived: number;
  attemptedMbps: number;
  consumedMbps: number;
  peakMbps: number;
  activities: ActivityLine[];
}

export interface ActivityCapacity {
  uplinkMbps: number;
  totalDemandMbps: number;
  totalConsumedMbps: number;
  saturationPct: number;
  overSubscribed: boolean;
  firmwareThroughputMbps: [number, number];
  capEnforceable: false;
  capNote: string;
}

export interface ActivityReport {
  mode: ActivityMode;
  windowMs: number;
  seed: number;
  startMs: number;
  endMs: number;
  generatedAtMs: number;
  flows: ActivityFlow[];
  results: FlowResult[];
  devices: ActivityDeviceSummary[];
  capacity: ActivityCapacity;
  totals: {
    flows: number;
    allowed: number;
    denied: number;
    dropped: number;
    notEnforceable: number;
    bytesAttempted: number;
    bytesAllowed: number;
    consumedMbps: number;
  };
  notes: string[];
}

const ACTIVITY_ZONES: ZoneId[] = ["guest", "trusted", "mgmt"];
const DEFAULT_MAX_PER_ACTIVITY = 60;
const MIN_FLOW_BYTES = 60;

export function isActivityCandidate(device: Pick<DeviceModel, "role" | "zone" | "isRouter" | "gateway">): boolean {
  return device.role === "iot" && !device.isRouter && !device.gateway && ACTIVITY_ZONES.includes(device.zone);
}

export function effectiveDemandMbps(device: Pick<DeviceModel, "demandMbps" | "trafficProfileId">): number {
  const behavior = activityBehaviorFor(device.trafficProfileId);
  if (device.demandMbps !== undefined && device.demandMbps !== null) return device.demandMbps;
  return behavior.demandMbps;
}

export function resolveActivityTarget(project: ProjectModel, targetKind: string, src: DeviceModel): string | null {
  const byId = (id: string): string | null => (project.devices.some((d) => d.id === id) ? id : null);
  const firstIn = (predicate: (d: DeviceModel) => boolean): string | null => project.devices.find(predicate)?.id ?? null;
  const hasService = (d: DeviceModel, name: string, port: number): boolean =>
    d.services.some((s) => s.name === name && s.port === port);

  switch (targetKind) {
    case "c2":
      return (
        byId("c2") ??
        firstIn((d) => d.zone === "internet" && d.role === "attacker" && d.id !== "attacker") ??
        firstIn((d) => d.zone === "internet" && d.role === "attacker")
      );
    case "vendor-cloud":
      return (
        byId("vendor-cloud") ??
        firstIn((d) => d.zone === "internet" && d.role === "external" && hasService(d, "https", 443)) ??
        firstIn((d) => d.zone === "internet" && d.role === "external")
      );
    case "dns-server":
      return (
        byId("dns-server") ??
        firstIn((d) => d.zone === "internet" && hasService(d, "dns", 53)) ??
        firstIn((d) => d.zone === "internet" && d.role === "infrastructure")
      );
    case "ntp-pool":
      return (
        byId("ntp-pool") ??
        firstIn((d) => d.zone === "internet" && hasService(d, "ntp", 123)) ??
        firstIn((d) => d.zone === "internet" && d.role === "infrastructure" && d.id !== "dns-server")
      );
    case "lan-local":
      return (
        firstIn((d) => d.isRouter) ??
        firstIn((d) => ACTIVITY_ZONES.includes(d.zone) && d.id !== src.id && d.role === "iot") ??
        null
      );
    case "internet":
      return byId("internet") ?? firstIn((d) => d.zone === "internet");
    default:
      return null;
  }
}

interface PlanParams {
  windowMs: number;
  startMs: number;
  seed: number;
  maxPerActivity: number;
  resolve: (targetKind: string) => string | null;
}

export function planDeviceActivity(
  device: Pick<DeviceModel, "id" | "name" | "demandMbps" | "trafficProfileId">,
  state: "normal" | "compromised",
  params: PlanParams,
  missingTargets: Set<string> = new Set()
): ActivityFlow[] {
  const behavior: ActivityBehavior = activityBehaviorFor(device.trafficProfileId);
  const demandMbps = effectiveDemandMbps(device);
  if (demandMbps <= 0) return [];
  const definitions = state === "compromised" ? behavior.compromised : behavior.normal;
  const totalBytes = (demandMbps * 1_000_000 * params.windowMs) / 8 / 1000;
  const rng = mulberry32(seedFor(params.seed, device.id, state));
  const flows: ActivityFlow[] = [];

  for (const definition of definitions) {
    const dstDeviceId = params.resolve(definition.target);
    if (!dstDeviceId) {
      missingTargets.add(definition.target);
      continue;
    }
    const definitionBytes = totalBytes * definition.share;
    if (definitionBytes < MIN_FLOW_BYTES) continue;
    const rawEvents = definitionBytes / definition.bytesPerEvent;
    const count = Math.max(1, Math.min(params.maxPerActivity, Math.round(rawEvents)));
    const bytesPerFlow = Math.max(MIN_FLOW_BYTES, Math.round(definitionBytes / count));
    const spacing = params.windowMs / count;
    const jitter = spacing * 0.35;
    const basePort = 40200 + (seedFor(params.seed, device.id, definition.id) % 180);
    for (let i = 0; i < count; i += 1) {
      const offset = spacing * (i + 0.5) + (rng() * 2 - 1) * jitter;
      const timestampMs = Math.round(params.startMs + Math.min(Math.max(offset, 1), params.windowMs));
      flows.push({
        id: `${device.id}:act:${definition.id}:${i}`,
        label: definition.label,
        kind: state === "compromised" ? "attack" : "traffic",
        timestampMs,
        srcDeviceId: device.id,
        dstDeviceId,
        protocol: definition.protocol,
        srcPort: basePort + (i % 64),
        dstPort: definition.dstPort,
        bytes: bytesPerFlow,
        sampleOf: Math.max(1, Math.round(bytesPerFlow / definition.bytesPerEvent)),
        activityId: definition.id,
        activityLabel: definition.label,
        activityTargetKind: definition.target
      });
    }
  }

  return flows.sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id));
}

export function runActivity(engine: SimEngine, project: ProjectModel, options: ActivityOptions): ActivityReport {
  const maxPerActivity = options.maxPerActivity ?? DEFAULT_MAX_PER_ACTIVITY;
  const startMs = engine.now + 1000;
  const endMs = startMs + options.windowMs;
  const candidates = project.devices.filter((device) => isActivityCandidate(device));
  const online = candidates.filter((device) => device.online);
  const offline = candidates.filter((device) => !device.online);
  const missingTargets = new Set<string>();
  const notes: string[] = [];
  const flows: ActivityFlow[] = [];
  const results: FlowResult[] = [];

  const planned: ActivityFlow[] = [];
  for (const device of online) {
    const state: "normal" | "compromised" =
      options.mode === "states" ? (device.compromised ? "compromised" : "normal") : options.mode;
    planned.push(
      ...planDeviceActivity(
        device,
        state,
        {
          windowMs: options.windowMs,
          startMs,
          seed: options.seed,
          maxPerActivity,
          resolve: (targetKind) => resolveActivityTarget(project, targetKind, device)
        },
        missingTargets
      )
    );
  }
  planned.sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id));
  for (const flow of planned) {
    engine.advanceTo(flow.timestampMs);
    results.push(engine.submitFlow(flow));
    flows.push(flow);
  }
  engine.advanceTo(endMs);

  const uplinkMbps = project.sim.uplinkMbps ?? 100;
  const capNote =
    project.firewall.dialect === "stateful"
      ? "per-device caps are configuration targets — the target design can rate-limit packets per second, but there is no bandwidth shaping in lwIP (Mbps caps are not enforced; estimate)"
      : "per-device caps are configuration targets only — the stock 4-list ACL has no rate or fairness concept, so bandwidth caps are not enforceable on this firmware";

  const devices = candidates.map((device) => summarizeDevice(device, options, flows, results));
  const totalDemandMbps = online.reduce((sum, device) => sum + effectiveDemandMbps(device), 0);
  const totalConsumedMbps = devices.reduce((sum, device) => sum + device.consumedMbps, 0);
  const overSubscribed = totalDemandMbps > uplinkMbps;

  if (missingTargets.size > 0) {
    notes.push(`no device could be resolved for target kind(s): ${[...missingTargets].sort().join(", ")} — those activities were skipped`);
  }
  if (offline.length > 0) {
    notes.push(`${offline.length} offline device(s) skipped: ${offline.map((d) => d.name).join(", ")}`);
  }
  notes.push(
    "generated flows are sampled representations: each row aggregates several raw events (sampleOf) so byte totals equal the configured demand while the engine evaluates a bounded number of flows"
  );
  notes.push(
    `routed throughput estimate for the ESP32 softAP + NAPT path is ${FIRMWARE_THROUGHPUT_ESTIMATE_MBPS[0]}–${FIRMWARE_THROUGHPUT_ESTIMATE_MBPS[1]} Mbps (estimate) — the uplink link rate is the LAN8720 Ethernet rate, not the router ceiling`
  );
  notes.push(capNote);
  if (overSubscribed) {
    notes.push(
      `total demand ${totalDemandMbps.toFixed(2)} Mbps exceeds the configured uplink ${uplinkMbps} Mbps — the model does not simulate queueing; a real link would stall and drop (estimate)`
    );
  }

  const totals = {
    flows: flows.length,
    allowed: results.filter((r) => r.verdict === "allowed").length,
    denied: results.filter((r) => r.verdict === "denied").length,
    dropped: results.filter((r) => r.verdict === "dropped").length,
    notEnforceable: results.filter((r) => r.verdict === "not-enforceable").length,
    bytesAttempted: flows.reduce((sum, flow) => sum + flow.bytes, 0),
    bytesAllowed: results.reduce((sum, result) => (result.verdict === "allowed" ? sum + (result.flow.bytes ?? 0) : sum), 0),
    consumedMbps: totalConsumedMbps
  };

  return {
    mode: options.mode,
    windowMs: options.windowMs,
    seed: options.seed,
    startMs,
    endMs,
    generatedAtMs: engine.now,
    flows,
    results,
    devices,
    capacity: {
      uplinkMbps,
      totalDemandMbps,
      totalConsumedMbps,
      saturationPct: uplinkMbps > 0 ? (totalDemandMbps / uplinkMbps) * 100 : 0,
      overSubscribed,
      firmwareThroughputMbps: FIRMWARE_THROUGHPUT_ESTIMATE_MBPS,
      capEnforceable: false,
      capNote
    },
    totals,
    notes
  };
}

function mbpsOf(bytes: number, windowMs: number): number {
  if (windowMs <= 0) return 0;
  return (bytes * 8 * 1000) / windowMs / 1_000_000;
}

function summarizeDevice(
  device: DeviceModel,
  options: ActivityOptions,
  flows: ActivityFlow[],
  results: FlowResult[]
): ActivityDeviceSummary {
  const deviceFlows = flows.filter((flow) => flow.srcDeviceId === device.id);
  const deviceResults = results.filter((result) => result.flow.srcDeviceId === device.id);
  const receivedFlows = flows.filter((flow) => flow.dstDeviceId === device.id && flow.srcDeviceId !== device.id);
  const state: "normal" | "compromised" =
    options.mode === "states" ? (device.compromised ? "compromised" : "normal") : options.mode;
  const demandMbps = effectiveDemandMbps(device);
  const bytesAttempted = deviceFlows.reduce((sum, flow) => sum + flow.bytes, 0);
  const allowedIds = new Set(deviceResults.filter((result) => result.verdict === "allowed").map((result) => result.flow.id));
  const bytesAllowed = deviceFlows.reduce((sum, flow) => (allowedIds.has(flow.id) ? sum + flow.bytes : sum), 0);

  const buckets = new Map<number, number>();
  for (const flow of deviceFlows) {
    if (!allowedIds.has(flow.id)) continue;
    const bucket = Math.floor(flow.timestampMs / 60_000);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + flow.bytes);
  }
  const peakBytesPerMinute = buckets.size > 0 ? Math.max(...buckets.values()) : 0;

  const activityMap = new Map<string, ActivityLine>();
  for (const flow of deviceFlows) {
    const line = activityMap.get(flow.activityId) ?? {
      activityId: flow.activityId,
      label: flow.activityLabel,
      targetDeviceId: flow.dstDeviceId,
      flows: 0,
      bytes: 0,
      allowedBytes: 0
    };
    line.flows += 1;
    line.bytes += flow.bytes;
    if (allowedIds.has(flow.id)) line.allowedBytes += flow.bytes;
    activityMap.set(flow.activityId, line);
  }

  return {
    deviceId: device.id,
    name: device.name,
    zone: device.zone,
    profileId: device.trafficProfileId,
    state,
    demandMbps,
    capMbps: device.capMbps ?? null,
    overCap: device.capMbps !== undefined && device.capMbps !== null && demandMbps > device.capMbps,
    offline: !device.online,
    flows: deviceResults.length,
    allowed: deviceResults.filter((result) => result.verdict === "allowed").length,
    denied: deviceResults.filter((result) => result.verdict === "denied").length,
    dropped: deviceResults.filter((result) => result.verdict === "dropped").length,
    notEnforceable: deviceResults.filter((result) => result.verdict === "not-enforceable").length,
    bytesAttempted,
    bytesAllowed,
    bytesReceived: receivedFlows.reduce((sum, flow) => sum + flow.bytes, 0),
    attemptedMbps: mbpsOf(bytesAttempted, options.windowMs),
    consumedMbps: mbpsOf(bytesAllowed, options.windowMs),
    peakMbps: (peakBytesPerMinute * 8 * 1000) / 60_000 / 1_000_000,
    activities: [...activityMap.values()].sort((a, b) => b.bytes - a.bytes)
  };
}
