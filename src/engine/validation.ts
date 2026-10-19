import type { ProjectModel } from "./model";
import type { Provenance } from "./types";
import { resolveCalibration, type CalibrationProfile } from "./calibration";
import { FIRMWARE_PROFILES, HARDWARE_PROFILES } from "../registry/profiles";

export interface FieldMeasurement {
  id: string;
  label: string;
  unit: string;
  expected: number | null;
  measured: number | null;
  tolerancePct: number;
  provenance: Provenance;
  note: string;
}

export interface ValidationRow extends FieldMeasurement {
  deltaPct: number | null;
  status: "ok" | "warn" | "fail" | "no-data";
}

export function buildValidationChecklist(project: ProjectModel, calibration: CalibrationProfile | null): FieldMeasurement[] {
  const cal = resolveCalibration(calibration);
  const firmware = FIRMWARE_PROFILES[project.sim.firmwareId];
  const board = HARDWARE_PROFILES.find((profile) => profile.id === project.sim.boardId);
  return [
    {
      id: "throughput-lan-wan",
      label: "LAN→WAN throughput",
      unit: "Mbps",
      expected: cal.throughputMbpsLanToWan,
      measured: null,
      tolerancePct: 20,
      provenance: cal.throughputMbpsLanToWan === null ? "estimate" : "measured",
      note:
        cal.throughputMbpsLanToWan === null
          ? "stock firmware reports 5–15 Mbps routed; record a real measurement and import it as calibration"
          : "expected value comes from the imported calibration profile"
    },
    {
      id: "throughput-wan-lan",
      label: "WAN→LAN throughput",
      unit: "Mbps",
      expected: cal.throughputMbpsWanToLan,
      measured: null,
      tolerancePct: 20,
      provenance: cal.throughputMbpsWanToLan === null ? "estimate" : "measured",
      note: "direction matters: inbound is usually slightly slower on this class of device"
    },
    {
      id: "clients",
      label: "Concurrent clients",
      unit: "clients",
      expected: cal.maxClients ?? (firmware.id === "target-v1" ? 12 : 8),
      measured: null,
      tolerancePct: 25,
      provenance: cal.maxClients === null ? "estimate" : "measured",
      note:
        cal.maxClients === null
          ? "stock builds degrade above ~8 associated clients; the target design aims higher"
          : "expected value comes from the imported calibration profile"
    },
    {
      id: "ram",
      label: "Free heap at idle",
      unit: "KB",
      expected: board ? Math.round(board.ramKb - cal.ramBaseKb) : null,
      measured: null,
      tolerancePct: 30,
      provenance: "estimate",
      note: "board SRAM is datasheet; the consumed base is an engine estimate until measured"
    }
  ];
}

export function evaluateValidation(checklist: FieldMeasurement[]): ValidationRow[] {
  return checklist.map((item) => {
    if (item.measured === null || item.expected === null || item.expected === 0) {
      return { ...item, deltaPct: null, status: "no-data" as const };
    }
    const deltaPct = Math.round(((item.measured - item.expected) / item.expected) * 1000) / 10;
    const abs = Math.abs(deltaPct);
    const status = abs <= item.tolerancePct ? "ok" : abs <= item.tolerancePct * 2 ? "warn" : "fail";
    return { ...item, deltaPct, status: status as ValidationRow["status"] };
  });
}

export function recordMeasurement(
  checklist: FieldMeasurement[],
  id: string,
  measured: number | null
): FieldMeasurement[] {
  return checklist.map((item) => (item.id === id ? { ...item, measured } : item));
}

export function validationToMarkdown(rows: ValidationRow[]): string {
  const lines = ["# Warden32 hardware validation", "", "| check | expected | measured | delta | status | provenance |"];
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    const expected = row.expected === null ? "n/a" : `${row.expected} ${row.unit}`;
    const measured = row.measured === null ? "not recorded" : `${row.measured} ${row.unit}`;
    const delta = row.deltaPct === null ? "—" : `${row.deltaPct > 0 ? "+" : ""}${row.deltaPct}%`;
    lines.push(`| ${row.label} | ${expected} | ${measured} | ${delta} | ${row.status} | ${row.provenance} |`);
  }
  lines.push("");
  lines.push("_Record real measurements on the hardware, then import them; the lab never invents `measured` values._");
  return lines.join("\n");
}
