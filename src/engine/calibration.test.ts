import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALIBRATION,
  parseCalibration,
  resolveCalibration,
  serializeCalibration,
  type CalibrationProfile
} from "./calibration";
import { buildValidationChecklist, evaluateValidation, recordMeasurement, validationToMarkdown } from "./validation";
import { SimEngine } from "./engine";
import { buildSampleFlows, buildSampleProject } from "../data/sampleLab";

function measuredProfile(): CalibrationProfile {
  return {
    id: "bench-1",
    name: "Owner bench run #1",
    source: "esp32_nat_router on WT32-ETH01, iperf3",
    createdAtMs: 1_700_000_000_000,
    notes: "Lan-to-wan iperf3 averaged 9.8 Mbps; heap at idle 214 KB.",
    provenance: "measured",
    metrics: {
      cpuCostEthernet: null,
      cpuCostWifiUplink: null,
      airtimeRoutedEthernet: null,
      airtimeRoutedWifi: null,
      airtimeL2Relay: null,
      ramBaseKb: null,
      throughputMbpsLanToWan: 9.8,
      throughputMbpsWanToLan: 8.1,
      maxClients: 6
    }
  };
}

describe("calibration profiles", () => {
  it("serializes and parses a profile round-trip", () => {
    const profile = measuredProfile();
    const parsed = parseCalibration(serializeCalibration(profile));
    expect(parsed.ok).toBe(true);
    expect(parsed.profile).toEqual(profile);
  });

  it("rejects malformed documents with explicit errors", () => {
    expect(parseCalibration("not json").ok).toBe(false);
    expect(parseCalibration(JSON.stringify({ kind: "other", version: 1, profile: {} })).errors.join("; ")).toContain(
      "unexpected kind"
    );
    const badMetric = parseCalibration(
      JSON.stringify({
        kind: "warden32.calibration",
        version: 1,
        profile: { id: "x", name: "x", metrics: { throughputMbpsLanToWan: -3 } }
      })
    );
    expect(badMetric.ok).toBe(false);
    expect(badMetric.errors.join("; ")).toContain("non-negative");
  });
});

describe("calibrated engine costs", () => {
  it("falls back to engine defaults for missing metrics", () => {
    const cal = resolveCalibration(DEFAULT_CALIBRATION);
    expect(cal.cpuCostEthernet).toBe(1.0);
    expect(cal.ramBaseKb).toBe(180);
  });

  it("applies imported CPU and airtime costs to flow results", () => {
    const project = buildSampleProject();
    const calibration: CalibrationProfile = {
      ...measuredProfile(),
      metrics: { ...measuredProfile().metrics, cpuCostEthernet: 5, airtimeRoutedEthernet: 2 }
    };
    const engine = new SimEngine(project, calibration);
    const flow = buildSampleFlows().find((f) => f.id === "f1")!;
    const result = engine.submitFlow(flow);
    expect(result.cpuCost).toBe(5);
    expect(result.airtimeCost).toBe(2);
  });

  it("adjusts the RAM base with the calibrated value", () => {
    const project = buildSampleProject();
    const engine = new SimEngine(project, {
      ...measuredProfile(),
      metrics: { ...measuredProfile().metrics, ramBaseKb: 200 }
    });
    expect(engine.resourceSnapshot().ramUsedKb).toBe(200);
  });
});

describe("hardware validation module", () => {
  it("builds a checklist with honest no-data status before measurements", () => {
    const project = buildSampleProject();
    const checklist = buildValidationChecklist(project, measuredProfile());
    const rows = evaluateValidation(checklist);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.status === "no-data")).toBe(true);
    expect(rows.find((row) => row.id === "throughput-lan-wan")?.expected).toBe(9.8);
  });

  it("classifies recorded measurements by tolerance", () => {
    const project = buildSampleProject();
    let checklist = buildValidationChecklist(project, measuredProfile());
    checklist = recordMeasurement(checklist, "throughput-lan-wan", 9.5);
    checklist = recordMeasurement(checklist, "throughput-wan-lan", 5.0);
    checklist = recordMeasurement(checklist, "clients", 2);
    const rows = evaluateValidation(checklist);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get("throughput-lan-wan")?.status).toBe("ok");
    expect(byId.get("throughput-wan-lan")?.status).toBe("warn");
    expect(byId.get("clients")?.status).toBe("fail");
  });

  it("exports the validation report to Markdown", () => {
    const project = buildSampleProject();
    const checklist = recordMeasurement(buildValidationChecklist(project, null), "clients", 7);
    const md = validationToMarkdown(evaluateValidation(checklist));
    expect(md).toContain("# Warden32 hardware validation");
    expect(md).toContain("never invents");
  });
});
