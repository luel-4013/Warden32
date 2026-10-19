import { describe, expect, it } from "vitest";
import { buildSampleProject } from "../data/sampleLab";
import { activityBehaviorFor } from "../registry/activity";
import { DEVICE_ARCHETYPES } from "../registry/devices";
import { effectiveDemandMbps, isActivityCandidate, planDeviceActivity, resolveActivityTarget, runActivity } from "./activity";
import { SimEngine } from "./engine";
import type { DeviceModel, ProjectModel } from "./model";

function project(): ProjectModel {
  return buildSampleProject();
}

function deviceOf(p: ProjectModel, id: string): DeviceModel {
  const device = p.devices.find((item) => item.id === id);
  if (!device) throw new Error(`missing ${id}`);
  return device;
}

describe("activity planning", () => {
  it("covers every IoT archetype traffic profile with a behavior", () => {
    for (const archetype of DEVICE_ARCHETYPES.filter((item) => item.category === "iot")) {
      expect(activityBehaviorFor(archetype.trafficProfileId), archetype.id).toBeDefined();
    }
  });

  it("is deterministic for the same seed", () => {
    const p = project();
    const cam = deviceOf(p, "cam");
    const params = {
      windowMs: 3_600_000,
      startMs: 1000,
      seed: 42,
      maxPerActivity: 60,
      resolve: (targetKind: string) => resolveActivityTarget(p, targetKind, cam)
    };
    const first = planDeviceActivity(cam, "normal", params);
    const second = planDeviceActivity(cam, "normal", params);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it("keeps every flow inside the window and respects the per-activity cap", () => {
    const p = project();
    const cam = deviceOf(p, "cam");
    const params = {
      windowMs: 3_600_000,
      startMs: 5000,
      seed: 7,
      maxPerActivity: 12,
      resolve: (targetKind: string) => resolveActivityTarget(p, targetKind, cam)
    };
    const flows = planDeviceActivity(cam, "normal", params);
    for (const flow of flows) {
      expect(flow.timestampMs).toBeGreaterThanOrEqual(params.startMs);
      expect(flow.timestampMs).toBeLessThanOrEqual(params.startMs + params.windowMs);
    }
    const byActivity = new Map<string, number>();
    for (const flow of flows) byActivity.set(flow.activityId, (byActivity.get(flow.activityId) ?? 0) + 1);
    for (const count of byActivity.values()) expect(count).toBeLessThanOrEqual(params.maxPerActivity);
  });

  it("sizes total bytes to the configured demand", () => {
    const p = project();
    const cam = deviceOf(p, "cam");
    const windowMs = 3_600_000;
    const flows = planDeviceActivity(cam, "normal", {
      windowMs,
      startMs: 0,
      seed: 3,
      maxPerActivity: 500,
      resolve: (targetKind: string) => resolveActivityTarget(p, targetKind, cam)
    });
    const totalBytes = flows.reduce((sum, flow) => sum + flow.bytes, 0);
    const expectedBytes = (effectiveDemandMbps(cam) * 1_000_000 * windowMs) / 8 / 1000;
    expect(totalBytes).toBeGreaterThan(expectedBytes * 0.9);
    expect(totalBytes).toBeLessThan(expectedBytes * 1.1);
  });

  it("produces attack flows targeting the C2 server in compromised mode", () => {
    const p = project();
    const cam = deviceOf(p, "cam");
    const flows = planDeviceActivity(cam, "compromised", {
      windowMs: 3_600_000,
      startMs: 0,
      seed: 9,
      maxPerActivity: 60,
      resolve: (targetKind: string) => resolveActivityTarget(p, targetKind, cam)
    });
    expect(flows.every((flow) => flow.kind === "attack")).toBe(true);
    expect(flows.some((flow) => flow.dstDeviceId === "c2")).toBe(true);
    expect(flows.some((flow) => flow.dstDeviceId === "dns-server")).toBe(true);
  });

  it("selects candidates among managed IoT devices only", () => {
    const p = project();
    expect(isActivityCandidate(deviceOf(p, "cam"))).toBe(true);
    expect(isActivityCandidate(deviceOf(p, "esp32"))).toBe(false);
    expect(isActivityCandidate(deviceOf(p, "attacker"))).toBe(false);
    expect(isActivityCandidate(deviceOf(p, "home-router"))).toBe(false);
  });
});

describe("activity runs", () => {
  it("evaluates a sample project run with accounting totals", () => {
    const p = project();
    const engine = new SimEngine(p);
    const report = runActivity(engine, p, { mode: "states", windowMs: 3_600_000, seed: p.sim.seed });
    expect(report.totals.flows).toBeGreaterThan(0);
    expect(report.devices.length).toBeGreaterThanOrEqual(3);
    const camSummary = report.devices.find((device) => device.deviceId === "cam");
    expect(camSummary).toBeDefined();
    expect(camSummary!.demandMbps).toBe(2.5);
    expect(camSummary!.consumedMbps).toBeGreaterThan(0);
    expect(report.capacity.uplinkMbps).toBe(100);
    expect(report.capacity.capEnforceable).toBe(false);
  });

  it("drops everything for a quarantined device", () => {
    const p = project();
    const engine = new SimEngine(p);
    engine.setQuarantine("cam", true, undefined);
    const report = runActivity(engine, p, { mode: "normal", windowMs: 600_000, seed: 1 });
    const camSummary = report.devices.find((device) => device.deviceId === "cam");
    expect(camSummary!.allowed).toBe(0);
    expect(camSummary!.dropped).toBe(camSummary!.flows);
    expect(camSummary!.consumedMbps).toBe(0);
  });

  it("skips offline devices and notes it", () => {
    const p = project();
    deviceOf(p, "plug").online = false;
    const engine = new SimEngine(p);
    const report = runActivity(engine, p, { mode: "normal", windowMs: 600_000, seed: 5 });
    const plugSummary = report.devices.find((device) => device.deviceId === "plug");
    expect(plugSummary!.flows).toBe(0);
    expect(plugSummary!.offline).toBe(true);
    expect(report.notes.some((note) => note.includes("offline"))).toBe(true);
  });

  it("flags over-cap devices and over-subscription honestly", () => {
    const p = project();
    p.sim.uplinkMbps = 1;
    const engine = new SimEngine(p);
    const report = runActivity(engine, p, { mode: "states", windowMs: 3_600_000, seed: p.sim.seed });
    const plugSummary = report.devices.find((device) => device.deviceId === "plug");
    expect(plugSummary!.overCap).toBe(true);
    expect(report.capacity.overSubscribed).toBe(true);
    expect(report.notes.some((note) => note.includes("queue"))).toBe(true);
  });

  it("is reproducible end to end for the same seed and fresh engine", () => {
    const p1 = project();
    const engine1 = new SimEngine(p1);
    const first = runActivity(engine1, p1, { mode: "states", windowMs: 600_000, seed: 99 });
    const p2 = project();
    const engine2 = new SimEngine(p2);
    const second = runActivity(engine2, p2, { mode: "states", windowMs: 600_000, seed: 99 });
    expect(first.totals).toEqual(second.totals);
    expect(first.flows).toEqual(second.flows);
  });
});
