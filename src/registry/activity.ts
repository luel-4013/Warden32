import type { Provenance } from "../engine/types";

export type ActivityTarget = "vendor-cloud" | "c2" | "dns-server" | "ntp-pool" | "lan-local" | "internet";

export interface ActivityDefinition {
  id: string;
  label: string;
  target: ActivityTarget;
  protocol: "TCP" | "UDP";
  dstPort: number;
  bytesPerEvent: number;
  share: number;
  provenance: Provenance;
}

export interface ActivityBehavior {
  demandMbps: number;
  demandProvenance: Provenance;
  normal: ActivityDefinition[];
  compromised: ActivityDefinition[];
}

function act(
  id: string,
  label: string,
  target: ActivityTarget,
  protocol: "TCP" | "UDP",
  dstPort: number,
  bytesPerEvent: number,
  share: number,
  provenance: Provenance = "assumption"
): ActivityDefinition {
  return { id, label, target, protocol, dstPort, bytesPerEvent, share, provenance };
}

interface CompromiseShape {
  exfilBytes: number;
  exfilLabel: string;
  exfilShare?: number;
}

function compromisedSet(shape: CompromiseShape): ActivityDefinition[] {
  const exfilShare = shape.exfilShare ?? 0.7;
  const rest = 1 - exfilShare;
  return [
    act("c2-beacon", "compromise — C2 beacon", "c2", "TCP", 8443, 512, rest * 0.1),
    act("dns-tunnel", "compromise — DNS tunnel", "dns-server", "UDP", 53, 220, rest * 0.45),
    act("lan-scan", "compromise — LAN scan", "lan-local", "TCP", 445, 96, rest * 0.45),
    act("exfil", shape.exfilLabel, "c2", "TCP", 443, shape.exfilBytes, exfilShare)
  ];
}

function behavior(
  demandMbps: number,
  normal: ActivityDefinition[],
  compromise: CompromiseShape
): ActivityBehavior {
  return { demandMbps, demandProvenance: "estimate", normal, compromised: compromisedSet(compromise) };
}

export const ACTIVITY_PROFILES: Record<string, ActivityBehavior> = {
  "stream-camera": behavior(
    2.0,
    [
      act("video", "video uplink frame", "vendor-cloud", "TCP", 443, 1400, 0.9, "paper"),
      act("keepalive", "cloud keepalive", "vendor-cloud", "TCP", 443, 200, 0.03),
      act("telemetry", "state telemetry", "vendor-cloud", "TCP", 8883, 350, 0.03),
      act("dns", "DNS lookup", "dns-server", "UDP", 53, 120, 0.02),
      act("ntp", "NTP sync", "ntp-pool", "UDP", 123, 76, 0.02)
    ],
    { exfilBytes: 32768, exfilLabel: "compromise — video archive exfiltration", exfilShare: 0.78 }
  ),
  "telemetry-mqtt": behavior(
    0.05,
    [
      act("mqtt", "MQTT state report", "vendor-cloud", "TCP", 8883, 380, 0.55, "paper"),
      act("update", "firmware/update check", "vendor-cloud", "TCP", 443, 1800, 0.2),
      act("dns", "DNS lookup", "dns-server", "UDP", 53, 120, 0.15),
      act("ntp", "NTP sync", "ntp-pool", "UDP", 123, 76, 0.1)
    ],
    { exfilBytes: 4096, exfilLabel: "compromise — telemetry data exfiltration" }
  ),
  "sensor-small": behavior(
    0.01,
    [
      act("measurement", "measurement report", "vendor-cloud", "TCP", 8883, 220, 0.5, "paper"),
      act("dns", "DNS lookup", "dns-server", "UDP", 53, 120, 0.3),
      act("ntp", "NTP sync", "ntp-pool", "UDP", 123, 76, 0.2)
    ],
    { exfilBytes: 1024, exfilLabel: "compromise — sensor data exfiltration" }
  ),
  "hub-aggregator": behavior(
    0.08,
    [
      act("cloud", "cloud sync", "vendor-cloud", "TCP", 8883, 900, 0.5, "paper"),
      act("local-poll", "local peer poll", "lan-local", "TCP", 80, 520, 0.4, "paper"),
      act("ntp", "NTP sync", "ntp-pool", "UDP", 123, 76, 0.1)
    ],
    { exfilBytes: 8192, exfilLabel: "compromise — aggregated data exfiltration", exfilShare: 0.75 }
  ),
  "stream-media": behavior(
    1.5,
    [
      act("media", "media chunk", "vendor-cloud", "TCP", 8443, 1400, 0.92, "paper"),
      act("standby", "standby poll", "vendor-cloud", "TCP", 443, 300, 0.04, "paper"),
      act("dns", "DNS lookup", "dns-server", "UDP", 53, 120, 0.02),
      act("ntp", "NTP sync", "ntp-pool", "UDP", 123, 76, 0.02)
    ],
    { exfilBytes: 16384, exfilLabel: "compromise — media catalog exfiltration" }
  ),
  "appliance-burst": behavior(
    0.15,
    [
      act("upload", "diagnostics/map upload", "vendor-cloud", "TCP", 8080, 4096, 0.55, "paper"),
      act("control", "control channel", "vendor-cloud", "TCP", 443, 620, 0.2),
      act("dns", "DNS lookup", "dns-server", "UDP", 53, 120, 0.15),
      act("ntp", "NTP sync", "ntp-pool", "UDP", 123, 76, 0.1)
    ],
    { exfilBytes: 65536, exfilLabel: "compromise — bulk data exfiltration" }
  ),
  "lock-event": behavior(
    0.02,
    [
      act("event", "unlock event report", "vendor-cloud", "TCP", 443, 700, 0.5, "paper"),
      act("keepalive", "keepalive", "vendor-cloud", "TCP", 443, 200, 0.2),
      act("dns", "DNS lookup", "dns-server", "UDP", 53, 120, 0.2),
      act("ntp", "NTP sync", "ntp-pool", "UDP", 123, 76, 0.1)
    ],
    { exfilBytes: 2048, exfilLabel: "compromise — unlock log exfiltration" }
  ),
  "generic-embedded": behavior(
    0.05,
    [
      act("keepalive", "cloud keepalive", "vendor-cloud", "TCP", 443, 300, 0.7),
      act("dns", "DNS lookup", "dns-server", "UDP", 53, 120, 0.2),
      act("ntp", "NTP sync", "ntp-pool", "UDP", 123, 76, 0.1)
    ],
    { exfilBytes: 4096, exfilLabel: "compromise — generic exfiltration" }
  )
};

export const FALLBACK_BEHAVIOR: ActivityBehavior = ACTIVITY_PROFILES["generic-embedded"];

export function activityBehaviorFor(profileId: string): ActivityBehavior {
  return ACTIVITY_PROFILES[profileId] ?? FALLBACK_BEHAVIOR;
}

export const FIRMWARE_THROUGHPUT_ESTIMATE_MBPS: [number, number] = [5, 15];
