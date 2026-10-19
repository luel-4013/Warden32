import { describe, expect, it } from "vitest";
import {
  COMPROMISE_PLAN,
  deviceState,
  generateCompromiseFlows,
  generateDeviceFlows,
  generateProfileFlows,
  profileIdForState,
  seedFor,
  STATE_PROFILE_OVERRIDE
} from "./traffic";
import type { DeviceModel } from "./model";

function fakeDevice(overrides: Partial<DeviceModel> = {}): DeviceModel {
  return {
    id: "cam",
    name: "Camera",
    role: "iot",
    zone: "guest",
    mac: "AA:BB:CC:DD:EE:01",
    ipv4: "10.0.0.11",
    interfaceId: null,
    online: true,
    compromised: false,
    behaviorState: "normal",
    quarantined: false,
    isRouter: false,
    gateway: false,
    extraIps: [],
    services: [],
    trafficProfileId: "stream-camera",
    vendorEndpoints: [],
    egressPolicyId: "vendor-only",
    managementPorts: [],
    notes: "",
    provenance: "paper",
    ...overrides
  };
}

const resolveAll = (target: string): string | null =>
  ({ "vendor-cloud": "vendor-cloud", "c2": "c2", "dns-server": "dns", "ntp-pool": "ntp", "guest-local": "plug" })[
    target
  ] ?? null;

describe("traffic profiles", () => {
  it("generates identical flows for identical seeds", () => {
    const params = { srcDeviceId: "cam", count: 5, startMs: 0, seed: 42, resolve: resolveAll };
    const a = generateProfileFlows("stream-camera", params);
    const b = generateProfileFlows("stream-camera", params);
    expect(a).toHaveLength(10);
    expect(a).toEqual(b);
  });

  it("spaces flows by interval with bounded jitter and monotonic time", () => {
    const flows = generateProfileFlows("stream-camera", {
      srcDeviceId: "cam",
      count: 4,
      startMs: 0,
      seed: 7,
      resolve: resolveAll
    });
    const video = flows.filter((f) => f.id.includes(":video:"));
    expect(video).toHaveLength(4);
    for (let i = 1; i < video.length; i++) {
      const delta = video[i].timestampMs - video[i - 1].timestampMs;
      expect(delta).toBeGreaterThanOrEqual(100);
      expect(delta).toBeLessThanOrEqual(140);
    }
    const times = flows.map((f) => f.timestampMs);
    expect([...times].sort((x, y) => x - y)).toEqual(times);
  });

  it("skips steps whose target cannot be resolved", () => {
    const flows = generateProfileFlows("telemetry-mqtt", {
      srcDeviceId: "plug",
      count: 2,
      startMs: 0,
      seed: 1,
      resolve: (target) => (target === "vendor-cloud" ? "vendor-cloud" : null)
    });
    expect(flows).toHaveLength(2);
    expect(flows.every((f) => f.dstDeviceId === "vendor-cloud")).toBe(true);
  });

  it("returns an empty list for unknown profiles", () => {
    expect(generateProfileFlows("nope", { srcDeviceId: "x", count: 3, startMs: 0, seed: 0, resolve: resolveAll })).toEqual([]);
  });
});

describe("device states", () => {
  it("derives the effective state from the compromised flag", () => {
    expect(deviceState(fakeDevice())).toBe("normal");
    expect(deviceState(fakeDevice({ behaviorState: "noisy" }))).toBe("noisy");
    expect(deviceState(fakeDevice({ compromised: true }))).toBe("compromised");
  });

  it("overrides the profile for noisy and misconfigured states", () => {
    const device = fakeDevice();
    expect(profileIdForState(device, "normal")).toBe("stream-camera");
    expect(profileIdForState(device, "noisy")).toBe(STATE_PROFILE_OVERRIDE.noisy);
    expect(profileIdForState(device, "misconfigured")).toBe(STATE_PROFILE_OVERRIDE.misconfigured);
    expect(profileIdForState(device, "compromised")).toBe("stream-camera");
  });

  it("keeps the base traffic while compromised and adds adversarial flows", () => {
    const device = fakeDevice({ compromised: true });
    const flows = generateDeviceFlows({
      device,
      count: 3,
      startMs: 0,
      seed: 11,
      resolve: resolveAll
    });
    const kinds = new Set(flows.map((f) => f.kind));
    expect(kinds.has("traffic")).toBe(true);
    expect(kinds.has("attack")).toBe(true);
    expect(flows.some((f) => f.label.includes("C2 beacon"))).toBe(true);
    expect(flows.some((f) => f.label.includes("lateral probe"))).toBe(true);
    expect(flows.some((f) => f.label.includes("DNS tunnel"))).toBe(true);
  });

  it("produces no adversarial flows for a healthy device", () => {
    const flows = generateDeviceFlows({ device: fakeDevice(), count: 2, startMs: 0, seed: 3, resolve: resolveAll });
    expect(flows.every((f) => f.kind !== "attack")).toBe(true);
  });
});

describe("compromise plan", () => {
  it("is deterministic and stays within the documented beacon window", () => {
    const params = { srcDeviceId: "cam", count: 4, startMs: 0, seed: 99, resolve: resolveAll };
    const a = generateCompromiseFlows(params);
    const b = generateCompromiseFlows(params);
    expect(a).toEqual(b);
    const beacons = a.filter((f) => f.id.includes(":beacon:"));
    expect(beacons).toHaveLength(4);
    for (let i = 1; i < beacons.length; i++) {
      const delta = beacons[i].timestampMs - beacons[i - 1].timestampMs;
      const max = COMPROMISE_PLAN.beaconIntervalMs + COMPROMISE_PLAN.beaconJitterMs;
      const min = COMPROMISE_PLAN.beaconIntervalMs - COMPROMISE_PLAN.beaconJitterMs;
      expect(delta).toBeGreaterThanOrEqual(min);
      expect(delta).toBeLessThanOrEqual(max);
    }
  });

  it("seedFor is stable and input-sensitive", () => {
    expect(seedFor(1, "cam", "stream-camera")).toBe(seedFor(1, "cam", "stream-camera"));
    expect(seedFor(1, "cam", "stream-camera")).not.toBe(seedFor(2, "cam", "stream-camera"));
    expect(seedFor(1, "cam", "stream-camera")).not.toBe(seedFor(1, "plug", "stream-camera"));
  });
});
