import { describe, expect, it } from "vitest";
import {
  compareResults,
  configFromProject,
  defaultComparisonConfigs,
  metricRows,
  runExperiment,
  runExperimentSuite
} from "./experiment";
import { buildSampleFlows, buildSampleProject } from "../data/sampleLab";
import { experimentToCsv, experimentToJson, experimentToMarkdown, experimentFileName } from "../storage/exports";
import { slugify } from "../storage/persistence";

const flows = buildSampleFlows();

describe("experiment runner", () => {
  it("runs flows deterministically for the same config", () => {
    const project = buildSampleProject();
    const config = configFromProject(project, "repeat-run");
    const a = runExperiment(project, config, flows);
    const b = runExperiment(project, config, flows);
    expect(experimentToJson(a)).toBe(experimentToJson(b));
  });

  it("does not mutate the base project", () => {
    const project = buildSampleProject();
    const stash = JSON.stringify(project);
    runExperiment(project, { ...configFromProject(project, "x"), firmwareId: "target-v1" }, flows);
    expect(JSON.stringify(project)).toBe(stash);
  });

  it("shows the policy difference between stock and target for C2 traffic", () => {
    const project = buildSampleProject();
    const results = runExperimentSuite(project, flows, defaultComparisonConfigs(project));
    expect(results).toHaveLength(3);
    const stock = results[0];
    const target = results[2];
    expect(stock.verdicts.allowed).toBeGreaterThan(target.verdicts.allowed);
    expect(target.verdicts.denied).toBeGreaterThan(stock.verdicts.denied);
    expect(target.ruleHits.some((row) => row.ruleId === "egress:vendor-only")).toBe(true);
  });

  it("compares results with per-metric provenance and deltas", () => {
    const project = buildSampleProject();
    const results = runExperimentSuite(project, flows, defaultComparisonConfigs(project));
    const rows = compareResults(results);
    const allowed = rows.find((row) => row.metric === "allowed");
    expect(allowed).toBeDefined();
    expect(allowed!.values).toHaveLength(3);
    expect(allowed!.delta).toMatch(/^[+-]?\d/);
    expect(rows.find((row) => row.metric === "peak CPU load")?.provenance).toBe("estimate");
  });

  it("reports traceable metric rows with provenance for every figure", () => {
    const project = buildSampleProject();
    const result = runExperiment(project, configFromProject(project, "metrics"), flows);
    const rows = metricRows(result);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const row of rows) {
      expect(row.how.length).toBeGreaterThan(10);
      expect(["measured", "datasheet", "paper", "estimate", "assumption"]).toContain(row.provenance);
    }
    expect(rows.find((row) => row.metric === "CPU cost")?.how).toContain("calibration");
  });
});

describe("experiment exports", () => {
  it("exports JSON with the full flow timeline", () => {
    const project = buildSampleProject();
    const result = runExperiment(project, configFromProject(project, "json-export"), flows);
    const parsed = JSON.parse(experimentToJson(result));
    expect(parsed.kind).toBe("warden32.experiment");
    expect(parsed.flows).toHaveLength(flows.length);
    expect(parsed.flows[0].natChain.length).toBeGreaterThan(0);
  });

  it("exports CSV with one row per flow plus the header", () => {
    const project = buildSampleProject();
    const result = runExperiment(project, configFromProject(project, "csv-export"), flows);
    const lines = experimentToCsv(result).split("\n");
    expect(lines).toHaveLength(flows.length + 1);
    expect(lines[0].split(",").length).toBe(19);
    expect(lines[1]).toContain('"');
  });

  it("exports Markdown with the provenance table and verdict list", () => {
    const project = buildSampleProject();
    const result = runExperiment(project, configFromProject(project, "md export"), flows);
    const md = experimentToMarkdown(result);
    expect(md).toContain("# Warden32 experiment");
    expect(md).toContain("| metric | value | provenance | derived from |");
    expect(md).toContain("| flow | src → dst | ports | verdict | matched | reason |");
    expect(md).toContain("estimate");
    expect(experimentFileName(result, "md")).toBe(`${slugify("warden32-md export")}.md`);
  });
});
