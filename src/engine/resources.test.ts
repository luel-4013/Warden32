import { describe, expect, it } from "vitest";
import { SimEngine } from "./engine";
import { FAILURE_INJECTIONS, failureById, injectFailure } from "./failures";
import { buildSampleFlows, buildSampleProject } from "../data/sampleLab";
import type { FirmwareProfileId } from "../registry/profiles";
import type { Flow } from "./types";

function makeEngine(firmwareId: FirmwareProfileId = "stock-eth"): SimEngine {
  const project = buildSampleProject();
  project.sim.firmwareId = firmwareId;
  return new SimEngine(project);
}

function sampleFlow(id: string): Flow {
  const flow = buildSampleFlows().find((f) => f.id === id);
  if (!flow) throw new Error(`missing ${id}`);
  return flow;
}

describe("resource snapshot", () => {
  it("reports table use, RAM estimates, and the estimate provenance", () => {
    const engine = makeEngine();
    const before = engine.resourceSnapshot();
    expect(before.conntrackUsed).toBe(0);
    expect(before.ramUsedKb).toBe(180);
    expect(before.provenance).toBe("estimate");
    expect(before.cpuLoadPct).toBe(0);

    engine.submitFlow(sampleFlow("f1"));
    const after = engine.resourceSnapshot();
    expect(after.conntrackUsed).toBe(1);
    expect(after.naptUsed).toBe(2);
    expect(after.cpuLoadPct).toBeGreaterThan(0);
  });

  it("honors a RAM override", () => {
    const engine = makeEngine();
    engine.project.resources.ramOverrideKb = 100;
    const snapshot = engine.resourceSnapshot();
    expect(snapshot.ramLimitKb).toBe(100);
    expect(snapshot.ramExhausted).toBe(true);
  });
});

describe("tx queue buffer model", () => {
  it("drops a flow when the burst overflows the queue and recovers after draining", () => {
    const engine = makeEngine();
    engine.project.resources.txQueueLength = 2;
    expect(engine.submitFlow(sampleFlow("f1")).verdict).toBe("allowed");
    expect(engine.submitFlow(sampleFlow("f2")).verdict).toBe("allowed");
    const third: Flow = {
      id: "f3q",
      label: "extra burst",
      kind: "legit",
      timestampMs: 0,
      srcDeviceId: "cam",
      dstDeviceId: "dns-server",
      protocol: "UDP",
      srcPort: 41500,
      dstPort: 53
    };
    const overflow = engine.submitFlow(third);
    expect(overflow.verdict).toBe("dropped");
    expect(overflow.reason).toContain("tx queue full");
    expect(overflow.labels).toContain("tx queue full — buffer exhaustion (estimate)");

    engine.advanceTo(1000);
    const after: Flow = { ...third, id: "f3q-again", srcPort: 41501 };
    expect(engine.submitFlow(after).verdict).toBe("allowed");
  });
});

describe("RAM model", () => {
  it("refuses new connections once the heap budget is exhausted", () => {
    const engine = makeEngine();
    engine.project.resources.ramOverrideKb = 181;
    expect(engine.submitFlow(sampleFlow("f1")).verdict).toBe("allowed");
    engine.advanceTo(200);
    expect(engine.submitFlow(sampleFlow("f2")).verdict).toBe("allowed");
    engine.advanceTo(400);
    const third: Flow = {
      id: "ram-f3",
      label: "extra connection",
      kind: "legit",
      timestampMs: 0,
      srcDeviceId: "cam",
      dstDeviceId: "dns-server",
      protocol: "UDP",
      srcPort: 41500,
      dstPort: 53
    };
    const blocked = engine.submitFlow(third);
    expect(blocked.verdict).toBe("dropped");
    expect(blocked.reason).toContain("heap exhausted");
    expect(blocked.labels).toContain("RAM exhausted — allocation refused");
  });
});

describe("CPU load estimate", () => {
  it("flags saturation without dropping (honest latency note)", () => {
    const engine = makeEngine("stock-wifi");
    engine.project.resources.txQueueLength = 100;
    let last: Flow | null = null;
    for (let i = 0; i < 20; i++) {
      const flow: Flow = {
        id: `burst-${i}`,
        label: "burst",
        kind: "legit",
        timestampMs: 0,
        srcDeviceId: "cam",
        dstDeviceId: "vendor-cloud",
        protocol: "TCP",
        srcPort: 50000 + i,
        dstPort: 443
      };
      const result = engine.submitFlow(flow);
      expect(result.verdict).toBe("allowed");
      last = flow;
    }
    const result = engine.submitFlow({
      id: "burst-final",
      label: "burst",
      kind: "legit",
      timestampMs: 0,
      srcDeviceId: "cam",
      dstDeviceId: "vendor-cloud",
      protocol: "TCP",
      srcPort: 51000,
      dstPort: 443
    });
    expect(result.labels.some((l) => l.includes("CPU load estimate"))).toBe(true);
    expect(last).not.toBeNull();
  });
});

describe("failure injections", () => {
  it("exposes unique ids and honest not-injectable entries", () => {
    const ids = FAILURE_INJECTIONS.map((injection) => injection.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(failureById("cpu-pressure")?.apply(makeEngine()).ok).toBe(false);
    expect(failureById("nope")).toBeNull();
  });

  it("drops routed traffic when the uplink goes down", () => {
    const engine = makeEngine();
    const result = injectFailure(engine, "uplink-down");
    expect(result.ok).toBe(true);
    const flowResult = engine.submitFlow(sampleFlow("f1"));
    expect(flowResult.verdict).toBe("dropped");
    expect(flowResult.reason).toContain("no route");
  });

  it("cuts off DNS-dependent traffic when the resolver is offline", () => {
    const engine = makeEngine();
    injectFailure(engine, "dns-offline");
    const flow: Flow = {
      id: "dns-lookup",
      label: "DNS lookup",
      kind: "legit",
      timestampMs: 0,
      srcDeviceId: "cam",
      dstDeviceId: "dns-server",
      protocol: "UDP",
      srcPort: 52000,
      dstPort: 53
    };
    const result = engine.submitFlow(flow);
    expect(result.verdict).toBe("dropped");
    expect(result.reason).toContain("offline");
  });

  it("applies the NAPT capacity on the next engine build", () => {
    const engine = makeEngine();
    injectFailure(engine, "napt-exhaustion");
    const project = buildSampleProject();
    project.resources.naptCapacity = 1;
    const constrained = new SimEngine(project);
    expect(constrained.submitFlow(sampleFlow("f1")).verdict).toBe("allowed");
    const second = constrained.submitFlow(sampleFlow("f2"));
    expect(second.verdict).toBe("dropped");
    expect(second.reason).toContain("NAPT table full");
  });
});
