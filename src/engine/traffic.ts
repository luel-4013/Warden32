import { mulberry32 } from "./rng";
import type { BehaviorState, DeviceModel } from "./model";
import type { Flow, FlowKind, Provenance } from "./types";

export type DeviceState = BehaviorState | "compromised";

export function deviceState(device: Pick<DeviceModel, "compromised" | "behaviorState">): DeviceState {
  return device.compromised ? "compromised" : device.behaviorState;
}

export interface TrafficStep {
  id: string;
  protocol: Flow["protocol"];
  target: string;
  dstPort: number;
  intervalMs: number;
  jitterMs: number;
  baseSrcPort: number;
  label: string;
}

export interface TrafficProfile {
  id: string;
  name: string;
  description: string;
  provenance: Provenance;
  steps: TrafficStep[];
}

function step(
  id: string,
  target: string,
  protocol: Flow["protocol"],
  dstPort: number,
  intervalMs: number,
  jitterMs: number,
  baseSrcPort: number,
  label: string
): TrafficStep {
  return { id, target, protocol, dstPort, intervalMs, jitterMs, baseSrcPort, label };
}

export const TRAFFIC_PROFILES: Record<string, TrafficProfile> = {
  "stream-camera": {
    id: "stream-camera",
    name: "Camera stream",
    description: "Continuous video frames to the vendor cloud with periodic keepalives.",
    provenance: "paper",
    steps: [
      step("video", "vendor-cloud", "TCP", 554, 120, 20, 41000, "video frame"),
      step("keepalive", "vendor-cloud", "TCP", 443, 5000, 200, 44000, "keepalive")
    ]
  },
  "telemetry-mqtt": {
    id: "telemetry-mqtt",
    name: "MQTT telemetry",
    description: "Small periodic state reports over MQTT-S with NTP.",
    provenance: "paper",
    steps: [
      step("mqtt", "vendor-cloud", "TCP", 8883, 10000, 500, 42000, "state report"),
      step("ntp", "ntp-pool", "UDP", 123, 300000, 1000, 41100, "clock sync")
    ]
  },
  "sensor-small": {
    id: "sensor-small",
    name: "Low-rate sensor",
    description: "Battery-class reporting: sparse DNS and MQTT.",
    provenance: "paper",
    steps: [
      step("dns", "dns-server", "UDP", 53, 60000, 5000, 40010, "resolve"),
      step("mqtt", "vendor-cloud", "TCP", 8883, 300000, 5000, 40020, "measurement")
    ]
  },
  "hub-aggregator": {
    id: "hub-aggregator",
    name: "Hub aggregator",
    description: "Local peer polling plus cloud sync — the noisiest lateral talker.",
    provenance: "paper",
    steps: [
      step("local-poll", "guest-local", "TCP", 80, 15000, 1000, 43000, "local poll"),
      step("cloud", "vendor-cloud", "TCP", 8883, 30000, 2000, 43050, "cloud sync")
    ]
  },
  "stream-media": {
    id: "stream-media",
    name: "Media stream",
    description: "Media chunks with standby polling.",
    provenance: "paper",
    steps: [
      step("chunk", "vendor-cloud", "TCP", 8443, 200, 50, 45000, "media chunk"),
      step("standby", "vendor-cloud", "TCP", 443, 15000, 1000, 45500, "standby poll")
    ]
  },
  "appliance-burst": {
    id: "appliance-burst",
    name: "Appliance burst",
    description: "Sparse control traffic with post-run upload bursts.",
    provenance: "paper",
    steps: [
      step("control", "vendor-cloud", "TCP", 443, 5000, 500, 46000, "control"),
      step("upload", "vendor-cloud", "TCP", 8080, 500, 100, 47000, "upload burst")
    ]
  },
  "lock-event": {
    id: "lock-event",
    name: "Event-driven device",
    description: "Silent until an event, then a short burst to the vendor.",
    provenance: "paper",
    steps: [
      step("event", "vendor-cloud", "TCP", 443, 600000, 10000, 48000, "unlock event"),
      step("ntp", "ntp-pool", "UDP", 123, 600000, 10000, 48100, "clock sync")
    ]
  },
  "generic-embedded": {
    id: "generic-embedded",
    name: "Generic embedded",
    description: "Keepalive-only baseline for unclassified firmware.",
    provenance: "assumption",
    steps: [step("keepalive", "vendor-cloud", "TCP", 443, 30000, 1000, 49000, "keepalive")]
  },
  "noisy-chatter": {
    id: "noisy-chatter",
    name: "Noisy chatter",
    description: "Misconfigured high-rate chatter — mDNS multicast plus cloud retries.",
    provenance: "assumption",
    steps: [
      step("mdns", "guest-local", "UDP", 5353, 1000, 100, 40100, "mDNS multicast"),
      step("retry", "vendor-cloud", "TCP", 443, 2000, 200, 40200, "cloud retry")
    ]
  },
  "misconfig-retry": {
    id: "misconfig-retry",
    name: "Misconfig retry storm",
    description: "Wrong server address and aggressive DNS retries.",
    provenance: "assumption",
    steps: [
      step("dns", "dns-server", "UDP", 53, 5000, 500, 40300, "DNS retry"),
      step("api", "vendor-cloud", "TCP", 443, 2000, 200, 40400, "failed API retry")
    ]
  }
};

export const STATE_PROFILE_OVERRIDE: Record<BehaviorState, string | null> = {
  normal: null,
  noisy: "noisy-chatter",
  misconfigured: "misconfig-retry"
};

export interface CompromisePlan {
  beaconIntervalMs: number;
  beaconJitterMs: number;
  lateralProbes: number;
  lateralIntervalMs: number;
  dnsTunnelIntervalMs: number;
}

export const COMPROMISE_PLAN: CompromisePlan = {
  beaconIntervalMs: 30000,
  beaconJitterMs: 3000,
  lateralProbes: 3,
  lateralIntervalMs: 2000,
  dnsTunnelIntervalMs: 15000
};

export interface FlowGeneratorParams {
  srcDeviceId: string;
  count: number;
  startMs: number;
  seed: number;
  resolve: (target: string) => string | null;
}

export function seedFor(seed: number, ...parts: string[]): number {
  let hash = 2166136261 ^ (seed >>> 0);
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      hash ^= part.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}

function kindFor(protocol: Flow["protocol"]): FlowKind {
  return protocol === "TCP" || protocol === "UDP" ? "traffic" : "legit";
}

export function generateProfileFlows(profileId: string, params: FlowGeneratorParams): Flow[] {
  const profile = TRAFFIC_PROFILES[profileId];
  if (!profile) return [];
  const rng = mulberry32(seedFor(params.seed, params.srcDeviceId, profileId));
  const flows: Flow[] = [];
  for (const trafficStep of profile.steps) {
    const dstDeviceId = params.resolve(trafficStep.target);
    if (!dstDeviceId) continue;
    let t = params.startMs;
    for (let i = 0; i < params.count; i++) {
      const jitter =
        trafficStep.jitterMs > 0
          ? Math.floor(rng() * (trafficStep.jitterMs * 2 + 1)) - trafficStep.jitterMs
          : 0;
      t += trafficStep.intervalMs + jitter;
      flows.push({
        id: `${params.srcDeviceId}:${trafficStep.id}:${i}`,
        label: `${profile.name} — ${trafficStep.label}`,
        kind: kindFor(trafficStep.protocol),
        timestampMs: t,
        srcDeviceId: params.srcDeviceId,
        dstDeviceId,
        protocol: trafficStep.protocol,
        srcPort: trafficStep.baseSrcPort + (i % 64),
        dstPort: trafficStep.dstPort
      });
    }
  }
  return flows.sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id));
}

export function generateCompromiseFlows(params: FlowGeneratorParams): Flow[] {
  const rng = mulberry32(seedFor(params.seed, params.srcDeviceId, "compromised"));
  const flows: Flow[] = [];
  const c2 = params.resolve("c2");
  if (c2) {
    let t = params.startMs;
    for (let i = 0; i < params.count; i++) {
      const jitter = Math.floor(rng() * (COMPROMISE_PLAN.beaconJitterMs * 2 + 1)) - COMPROMISE_PLAN.beaconJitterMs;
      t += COMPROMISE_PLAN.beaconIntervalMs + jitter;
      flows.push({
        id: `${params.srcDeviceId}:beacon:${i}`,
        label: "Compromise — C2 beacon",
        kind: "attack",
        timestampMs: t,
        srcDeviceId: params.srcDeviceId,
        dstDeviceId: c2,
        protocol: "TCP",
        srcPort: 45000 + (i % 64),
        dstPort: 8443
      });
    }
  }
  const local = params.resolve("guest-local");
  if (local) {
    let t = params.startMs;
    for (let i = 0; i < Math.min(params.count > 0 ? COMPROMISE_PLAN.lateralProbes : 0, COMPROMISE_PLAN.lateralProbes); i++) {
      t += COMPROMISE_PLAN.lateralIntervalMs;
      flows.push({
        id: `${params.srcDeviceId}:lateral:${i}`,
        label: "Compromise — lateral probe",
        kind: "attack",
        timestampMs: t,
        srcDeviceId: params.srcDeviceId,
        dstDeviceId: local,
        protocol: "TCP",
        srcPort: 46000 + (i % 64),
        dstPort: i % 2 === 0 ? 80 : 22
      });
    }
  }
  const dns = params.resolve("dns-server");
  if (dns) {
    let t = params.startMs;
    for (let i = 0; i < params.count; i++) {
      const jitter = Math.floor(rng() * 2001) - 1000;
      t += COMPROMISE_PLAN.dnsTunnelIntervalMs + jitter;
      flows.push({
        id: `${params.srcDeviceId}:dnstunnel:${i}`,
        label: "Compromise — DNS tunnel",
        kind: "attack",
        timestampMs: t,
        srcDeviceId: params.srcDeviceId,
        dstDeviceId: dns,
        protocol: "UDP",
        srcPort: 40500 + (i % 64),
        dstPort: 53
      });
    }
  }
  return flows.sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id));
}

export interface DeviceFlowParams extends Omit<FlowGeneratorParams, "srcDeviceId"> {
  device: Pick<DeviceModel, "id" | "trafficProfileId" | "behaviorState" | "compromised">;
  state?: DeviceState;
}

export function profileIdForState(
  device: Pick<DeviceModel, "trafficProfileId" | "behaviorState" | "compromised">,
  state: DeviceState
): string {
  if (state === "compromised") return device.trafficProfileId;
  return STATE_PROFILE_OVERRIDE[state] ?? device.trafficProfileId;
}

export function generateDeviceFlows(params: DeviceFlowParams): Flow[] {
  const state = params.state ?? deviceState(params.device);
  const profileId = profileIdForState(params.device, state);
  const base = generateProfileFlows(profileId, { ...params, srcDeviceId: params.device.id });
  if (state !== "compromised") return base;
  const compromise = generateCompromiseFlows({ ...params, srcDeviceId: params.device.id });
  return [...base, ...compromise].sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id));
}
