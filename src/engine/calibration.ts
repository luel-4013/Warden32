import type { Provenance } from "./types";
import {
  AIRTIME_L2_RELAY,
  AIRTIME_ROUTED_ETHERNET,
  AIRTIME_ROUTED_WIFI,
  CPU_ETHERNET,
  CPU_WIFI_UPLINK,
  RAM_BASE_KB
} from "./calibrationDefaults";

export interface CalibrationMetrics {
  cpuCostEthernet: number | null;
  cpuCostWifiUplink: number | null;
  airtimeRoutedEthernet: number | null;
  airtimeRoutedWifi: number | null;
  airtimeL2Relay: number | null;
  ramBaseKb: number | null;
  throughputMbpsLanToWan: number | null;
  throughputMbpsWanToLan: number | null;
  maxClients: number | null;
}

export interface CalibrationProfile {
  id: string;
  name: string;
  source: string;
  createdAtMs: number;
  notes: string;
  provenance: Provenance;
  metrics: CalibrationMetrics;
}

export interface ResolvedCalibration {
  cpuCostEthernet: number;
  cpuCostWifiUplink: number;
  airtimeRoutedEthernet: number;
  airtimeRoutedWifi: number;
  airtimeL2Relay: number;
  ramBaseKb: number;
  throughputMbpsLanToWan: number | null;
  throughputMbpsWanToLan: number | null;
  maxClients: number | null;
}

function emptyMetrics(): CalibrationMetrics {
  return {
    cpuCostEthernet: null,
    cpuCostWifiUplink: null,
    airtimeRoutedEthernet: null,
    airtimeRoutedWifi: null,
    airtimeL2Relay: null,
    ramBaseKb: null,
    throughputMbpsLanToWan: null,
    throughputMbpsWanToLan: null,
    maxClients: null
  };
}

export const DEFAULT_CALIBRATION: CalibrationProfile = {
  id: "default",
  name: "Engine defaults",
  source: "engine constants (estimate)",
  createdAtMs: 0,
  notes: "Relative cost units used until measurements from real hardware are imported.",
  provenance: "estimate",
  metrics: emptyMetrics()
};

const METRIC_KEYS: (keyof CalibrationMetrics)[] = [
  "cpuCostEthernet",
  "cpuCostWifiUplink",
  "airtimeRoutedEthernet",
  "airtimeRoutedWifi",
  "airtimeL2Relay",
  "ramBaseKb",
  "throughputMbpsLanToWan",
  "throughputMbpsWanToLan",
  "maxClients"
];

export function resolveCalibration(profile: CalibrationProfile | null): ResolvedCalibration {
  const metrics = profile?.metrics ?? emptyMetrics();
  return {
    cpuCostEthernet: metrics.cpuCostEthernet ?? CPU_ETHERNET,
    cpuCostWifiUplink: metrics.cpuCostWifiUplink ?? CPU_WIFI_UPLINK,
    airtimeRoutedEthernet: metrics.airtimeRoutedEthernet ?? AIRTIME_ROUTED_ETHERNET,
    airtimeRoutedWifi: metrics.airtimeRoutedWifi ?? AIRTIME_ROUTED_WIFI,
    airtimeL2Relay: metrics.airtimeL2Relay ?? AIRTIME_L2_RELAY,
    ramBaseKb: metrics.ramBaseKb ?? RAM_BASE_KB,
    throughputMbpsLanToWan: metrics.throughputMbpsLanToWan,
    throughputMbpsWanToLan: metrics.throughputMbpsWanToLan,
    maxClients: metrics.maxClients
  };
}

export function serializeCalibration(profile: CalibrationProfile): string {
  return JSON.stringify({ kind: "warden32.calibration", version: 1, profile }, null, 2);
}

export function parseCalibration(text: string): {
  ok: boolean;
  profile: CalibrationProfile | null;
  errors: string[];
} {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, profile: null, errors: ["not valid JSON"] };
  }
  const doc = raw as { kind?: string; version?: number; profile?: Partial<CalibrationProfile> };
  if (doc.kind !== "warden32.calibration") errors.push(`unexpected kind: ${String(doc.kind)}`);
  if (doc.version !== 1) errors.push(`unsupported version: ${String(doc.version)}`);
  const profile = doc.profile;
  if (!profile || typeof profile !== "object") {
    errors.push("missing profile object");
    return { ok: false, profile: null, errors };
  }
  if (typeof profile.id !== "string" || profile.id.length === 0) errors.push("profile id must be a non-empty string");
  if (typeof profile.name !== "string" || profile.name.length === 0) errors.push("profile name must be a non-empty string");
  if (profile.metrics && typeof profile.metrics === "object") {
    for (const key of Object.keys(profile.metrics)) {
      if (!METRIC_KEYS.includes(key as keyof CalibrationMetrics)) {
        errors.push(`unknown metric: ${key}`);
        continue;
      }
      const value = (profile.metrics as unknown as Record<string, unknown>)[key];
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
        errors.push(`metric ${key} must be a non-negative number or null`);
      }
    }
  } else {
    errors.push("metrics object missing");
  }
  if (errors.length > 0) return { ok: false, profile: null, errors };
  return {
    ok: true,
    profile: {
      id: profile.id as string,
      name: profile.name as string,
      source: typeof profile.source === "string" ? profile.source : "",
      createdAtMs: typeof profile.createdAtMs === "number" ? profile.createdAtMs : 0,
      notes: typeof profile.notes === "string" ? profile.notes : "",
      provenance: (["measured", "datasheet", "paper", "estimate", "assumption"].includes(profile.provenance as string)
        ? profile.provenance
        : "measured") as Provenance,
      metrics: { ...emptyMetrics(), ...(profile.metrics as CalibrationMetrics) }
    },
    errors: []
  };
}
