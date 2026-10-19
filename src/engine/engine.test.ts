import { describe, expect, it } from "vitest";
import { SimEngine } from "./engine";
import { buildSampleFlows, buildSampleProject } from "../data/sampleLab";
import type { FirmwareProfileId } from "../registry/profiles";
import type { Flow } from "./types";

function makeEngine(firmwareId: FirmwareProfileId): SimEngine {
  const project = buildSampleProject();
  project.sim.firmwareId = firmwareId;
  if (firmwareId === "target-v1") {
    project.firewall.dialect = "stateful";
    project.firewall.defaultPolicy = "deny";
  }
  if (firmwareId === "softap-sta") {
    project.firewall.dialect = "none";
  }
  return new SimEngine(project);
}

function sampleFlow(id: string): Flow {
  const flow = buildSampleFlows().find((f) => f.id === id);
  if (!flow) throw new Error(`missing sample flow ${id}`);
  return flow;
}

describe("visibility layer", () => {
  it("marks guest-to-guest traffic as not enforceable (Wi-Fi driver relay)", () => {
    const result = makeEngine("stock-eth").submitFlow(sampleFlow("f3"));
    expect(result.verdict).toBe("not-enforceable");
    expect(result.visibleToFirewall).toBe(false);
    expect(result.enforcementPoint).toBe("wifi-driver");
    expect(result.cpuCost).toBe(0);
    expect(result.airtimeCost).toBeGreaterThan(0);
    expect(result.natChain).toHaveLength(0);
  });

  it("passes non-IPv4 unfiltered through the stock IPv4-only ACL", () => {
    const result = makeEngine("stock-eth").submitFlow(sampleFlow("f6"));
    expect(result.verdict).toBe("allowed");
    expect(result.labels.some((l) => l.includes("non-IPv4"))).toBe(true);
  });
});

describe("NAT boundary", () => {
  it("drops unsolicited inbound traffic at the upstream NAT boundary", () => {
    const result = makeEngine("stock-eth").submitFlow(sampleFlow("f4"));
    expect(result.verdict).toBe("dropped");
    expect(result.reason).toContain("NAT boundary");
    expect(result.natChain).toHaveLength(0);
  });

  it("rewrites outbound source twice (double NAT) and stays deterministic", () => {
    const engineA = makeEngine("stock-eth");
    const first = engineA.submitFlow(sampleFlow("f1"));
    expect(first.verdict).toBe("allowed");
    expect(first.natChain).toHaveLength(2);
    expect(first.natChain[0].toIp).toBe("192.168.1.23");
    expect(first.natChain[1].toIp).toBe("203.0.113.7");
    expect(first.route).toContain("default route");

    const again = engineA.submitFlow(sampleFlow("f1"));
    expect(again.natChain[1].toPort).toBe(first.natChain[1].toPort);
    expect(again.natChain[0].toPort).toBe(first.natChain[0].toPort);

    const engineB = makeEngine("stock-eth");
    const fresh = engineB.submitFlow(sampleFlow("f1"));
    expect(fresh.natChain[0].toPort).toBe(first.natChain[0].toPort);
    expect(fresh.natChain[1].toPort).toBe(first.natChain[1].toPort);
  });
});

describe("stock management surface", () => {
  it("allows guest clients to reach the ESP32 management surface by default", () => {
    const result = makeEngine("stock-eth").submitFlow(sampleFlow("f5"));
    expect(result.verdict).toBe("allowed");
    expect(result.matchedRule).toBeNull();
    expect(result.labels.some((l) => l.includes("management surface reachable"))).toBe(true);
  });

  it("denies it under the target design and flags it as not implemented on hardware", () => {
    const result = makeEngine("target-v1").submitFlow(sampleFlow("f5"));
    expect(result.verdict).toBe("denied");
    expect(result.matchedRule).toBe("target:mgmt-serial-only");
    expect(result.labels).toContain("not implemented on hardware");
  });
});

describe("egress policy", () => {
  it("permits C2 traffic on stock (default allow) but denies it under target vendor-only", () => {
    const stock = makeEngine("stock-eth").submitFlow(sampleFlow("f2"));
    expect(stock.verdict).toBe("allowed");
    expect(stock.labels.some((l) => l.includes("no egress filtering"))).toBe(true);

    const target = makeEngine("target-v1").submitFlow(sampleFlow("f2"));
    expect(target.verdict).toBe("denied");
    expect(target.matchedRule).toBe("egress:vendor-only");
  });

  it("allows vendor traffic even under stateful default-deny (device allowlist wins over default)", () => {
    const target = makeEngine("target-v1");
    const result = target.submitFlow(sampleFlow("f1"));
    expect(result.verdict).toBe("allowed");
    expect(result.matchedRule).toBe("egress:vendor-only");
  });
});

describe("routing", () => {
  it("drops guest→trusted-LAN traffic: upstream has no route to the disabled logical zone", () => {
    const result = makeEngine("stock-eth").submitFlow(sampleFlow("f7"));
    expect(result.verdict).toBe("dropped");
    expect(result.reason).toContain("no route");
    expect(result.natChain).toHaveLength(2);
  });

  it("emits a structured event stream for an allowed flow", () => {
    const engine = makeEngine("stock-eth");
    const before = engine.events.lastId;
    engine.submitFlow(sampleFlow("f1"));
    const events = engine.events.since(before);
    const categories = events.map((e) => e.category);
    expect(categories).toContain("pipeline");
    expect(categories).toContain("firewall");
    expect(categories).toContain("nat");
    expect(categories).toContain("routing");
    expect(events.some((e) => e.message.startsWith("ALLOWED"))).toBe(true);
  });
});

describe("reproducibility", () => {
  it("same seed and same flows produce identical results and rule hit counters", () => {
    const a = makeEngine("stock-eth");
    const b = makeEngine("stock-eth");
    for (const flow of buildSampleFlows()) {
      const ra = a.submitFlow(flow);
      const rb = b.submitFlow(flow);
      expect(ra.verdict).toBe(rb.verdict);
      expect(ra.reason).toBe(rb.reason);
      expect(ra.natChain.map((h) => `${h.toIp}:${h.toPort}`)).toEqual(rb.natChain.map((h) => `${h.toIp}:${h.toPort}`));
      expect(ra.events.map((e) => e.message)).toEqual(rb.events.map((e) => e.message));
    }
  });
});

describe("connection tracking in the pipeline", () => {
  it("allows return traffic for an established flow without re-evaluating rules", () => {
    const engine = makeEngine("target-v1");
    const outbound = engine.submitFlow(sampleFlow("f1"));
    expect(outbound.verdict).toBe("allowed");
    expect(engine.connections.size).toBe(1);

    const reply: Flow = {
      id: "f1-reply",
      label: "Vendor cloud → camera (TLS reply)",
      kind: "legit",
      timestampMs: 1010,
      srcDeviceId: "vendor-cloud",
      dstDeviceId: "cam",
      protocol: "TCP",
      srcPort: 443,
      dstPort: 41000
    };
    const result = engine.submitFlow(reply);
    expect(result.verdict).toBe("allowed");
    expect(result.matchedRule).toBe("conntrack:established");
    expect(result.connState).toBe("ESTABLISHED");
  });

  it("treats a repeated flow as established on the second submission", () => {
    const engine = makeEngine("stock-eth");
    engine.submitFlow(sampleFlow("f1"));
    const again = engine.submitFlow(sampleFlow("f1"));
    expect(again.matchedRule).toBe("conntrack:established");
    expect(again.connState).toBe("ESTABLISHED");
  });

  it("drops new flows when the connection table is full", () => {
    const project = buildSampleProject();
    project.resources.conntrackCapacity = 1;
    const engine = new SimEngine(project);
    expect(engine.submitFlow(sampleFlow("f1")).verdict).toBe("allowed");
    const full = engine.submitFlow(sampleFlow("f2"));
    expect(full.verdict).toBe("dropped");
    expect(full.reason).toContain("connection tracking table full");
    expect(full.labels).toContain("connection table exhausted");
  });

  it("expires connections over time and re-evaluates rules afterwards", () => {
    const engine = makeEngine("stock-eth");
    engine.submitFlow(sampleFlow("f1"));
    expect(engine.connections.size).toBe(1);
    const events = engine.advanceTo(400_000);
    expect(engine.connections.size).toBe(0);
    expect(events.some((e) => e.message.includes("expired"))).toBe(true);

    const again = engine.submitFlow(sampleFlow("f1"));
    expect(again.matchedRule).toBeNull();
    expect(again.connState).toBe("NEW");
  });

  it("drops INVALID states under the stateful dialect but not on stock", () => {
    const invalid: Flow = { ...sampleFlow("f2"), forcedConnState: "INVALID" };
    const target = makeEngine("target-v1").submitFlow(invalid);
    expect(target.verdict).toBe("denied");
    expect(target.matchedRule).toBe("conntrack:invalid");
    expect(target.reason).toContain("invalid connection state");

    const stock = makeEngine("stock-eth").submitFlow(invalid);
    expect(stock.verdict).toBe("allowed");
  });
});

describe("DNAT port-forwarding", () => {
  function withForwards(ids: string[]): SimEngine {
    const project = buildSampleProject();
    for (const forward of project.portForwards) {
      forward.enabled = ids.includes(forward.id);
    }
    return new SimEngine(project);
  }

  const inbound: Flow = {
    id: "in-rtsp",
    label: "Attacker → camera RTSP via forwarded port",
    kind: "inbound",
    timestampMs: 8000,
    srcDeviceId: "attacker",
    dstDeviceId: "cam",
    protocol: "TCP",
    srcPort: 51000,
    dstPort: 8554
  };

  it("chains both DNAT hops when both routers have forwards", () => {
    const result = withForwards(["gw-rtsp", "esp-rtsp"]).submitFlow(inbound);
    expect(result.verdict).toBe("allowed");
    expect(result.natChain).toHaveLength(2);
    expect(`${result.natChain[0].toIp}:${result.natChain[0].toPort}`).toBe("192.168.1.23:8554");
    expect(`${result.natChain[1].toIp}:${result.natChain[1].toPort}`).toBe("10.0.0.11:554");
    expect(result.matchedRule).toBe("port-forward:explicit");
    expect(result.labels.some((l) => l.includes("exposes an internal service"))).toBe(true);
    expect(result.connState).toBe("NEW");
  });

  it("drops at the upstream boundary when only the ESP32 forward exists", () => {
    const result = withForwards(["esp-rtsp"]).submitFlow(inbound);
    expect(result.verdict).toBe("dropped");
    expect(result.reason).toContain("no port-forward configured");
  });

  it("drops at the ESP32 boundary when only the upstream forward exists", () => {
    const result = withForwards(["gw-rtsp"]).submitFlow(inbound);
    expect(result.verdict).toBe("dropped");
    expect(result.reason).toContain("no DNAT mapping");
  });

  it("lets a port-forward flow become return traffic after creation", () => {
    const engine = withForwards(["gw-rtsp", "esp-rtsp"]);
    expect(engine.submitFlow(inbound).verdict).toBe("allowed");
    const reply: Flow = {
      ...inbound,
      id: "in-rtsp-reply",
      srcDeviceId: "cam",
      dstDeviceId: "attacker",
      srcPort: 554,
      dstPort: 51000
    };
    const result = engine.submitFlow(reply);
    expect(result.verdict).toBe("allowed");
    expect(result.matchedRule).toBe("conntrack:established");
  });
});

describe("ingress source checks and rate limits", () => {
  it("drops spoofed source addresses at ingress", () => {
    const spoof: Flow = { ...sampleFlow("f4"), spoofedSrcIp: "10.0.0.11" };
    const result = makeEngine("stock-eth").submitFlow(spoof);
    expect(result.verdict).toBe("dropped");
    expect(result.matchedRule).toBe("ingress:source-check");
    expect(result.labels).toContain("spoofed source rejected at ingress");
  });

  it("enforces per-rule rate limits and resets them on the next window", () => {
    const project = buildSampleProject();
    project.sim.firmwareId = "target-v1";
    project.firewall.dialect = "stateful";
    project.firewall.defaultPolicy = "deny";
    project.firewall.rules.unshift({
      id: "rate-cam",
      name: "camera upload (rate limited)",
      enabled: true,
      src: "cam",
      dst: "any",
      srcZone: "any",
      dstZone: "any",
      protocol: "any",
      srcPorts: null,
      dstPorts: null,
      inInterface: "any",
      outInterface: "any",
      connStates: null,
      action: "accept",
      log: true,
      rateLimitPerSec: 1,
      description: "test rule"
    });
    const engine = new SimEngine(project);
    const first = engine.submitFlow(sampleFlow("f1"));
    expect(first.verdict).toBe("allowed");
    expect(first.matchedRule).toBe("rate-cam");

    const second = engine.submitFlow({ ...sampleFlow("f1"), id: "f1b", srcPort: 42000 });
    expect(second.verdict).toBe("denied");
    expect(second.reason).toContain("rate limit");

    engine.advanceTo(1001);
    const third = engine.submitFlow({ ...sampleFlow("f1"), id: "f1c", srcPort: 43000 });
    expect(third.verdict).toBe("allowed");
  });
});
