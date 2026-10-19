import { describe, expect, it } from "vitest";
import { ATTACK_SCENARIOS, attackById, runScenario } from "./attacks";
import { SimEngine } from "./engine";
import { buildSampleProject } from "../data/sampleLab";
import type { FirmwareProfileId } from "../registry/profiles";

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

describe("attack catalog", () => {
  it("has unique ids, valid provenance, and non-empty descriptions", () => {
    const ids = ATTACK_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scenario of ATTACK_SCENARIOS) {
      expect(scenario.description.length).toBeGreaterThan(20);
      expect(["measured", "datasheet", "paper", "estimate", "assumption"]).toContain(scenario.provenance);
    }
    expect(attackById("c2-beacon")?.category).toBe("c2");
    expect(attackById("nope")).toBeNull();
  });

  it("keeps unmodeled scenarios empty and honest", () => {
    const unmodeled = ATTACK_SCENARIOS.filter((scenario) => !scenario.modeled);
    expect(unmodeled.length).toBeGreaterThanOrEqual(2);
    const project = buildSampleProject();
    for (const scenario of unmodeled) {
      expect(scenario.build(project, 0)).toEqual([]);
      expect(scenario.description.toLowerCase()).toContain("not modeled");
    }
  });
});

describe("attack scenarios through the engine", () => {
  it("drops the inbound port scan at the NAT boundary when no forwards exist", () => {
    const engine = makeEngine("stock-eth");
    const results = runScenario(engine, attackById("recon-port-scan")!);
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.verdict === "dropped")).toBe(true);
    expect(results.every((r) => r.reason.includes("NAT boundary"))).toBe(true);
  });

  it("lets only the forwarded port through when both routers forward RTSP", () => {
    const project = buildSampleProject();
    for (const forward of project.portForwards) forward.enabled = true;
    const engine = new SimEngine(project);
    const results = runScenario(engine, attackById("recon-port-scan")!, 0);
    const byPort = new Map(results.map((r) => [r.flow.dstPort, r.verdict]));
    expect(byPort.get(8554)).toBe("allowed");
    expect(byPort.get(22)).toBe("dropped");
    expect(byPort.get(554)).toBe("dropped");
  });

  it("marks guest-to-guest lateral probes as not enforceable", () => {
    const engine = makeEngine("stock-eth");
    const results = runScenario(engine, attackById("lateral-probe")!, 0);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.verdict === "not-enforceable")).toBe(true);
    expect(results.every((r) => r.labels.some((l) => l.includes("client isolation")))).toBe(true);
  });

  it("labels ARP spoofing as relayed by the Wi-Fi driver", () => {
    const results = runScenario(makeEngine("stock-eth"), attackById("lateral-arp-spoof")!, 0);
    expect(results.every((r) => r.verdict === "not-enforceable")).toBe(true);
  });

  it("allows C2 beacons on stock and denies them under the target vendor-only policy", () => {
    const stock = runScenario(makeEngine("stock-eth"), attackById("c2-beacon")!, 0);
    expect(stock.every((r) => r.verdict === "allowed")).toBe(true);

    const target = runScenario(makeEngine("target-v1"), attackById("c2-beacon")!, 0);
    expect(target.every((r) => r.verdict === "denied")).toBe(true);
    expect(target.every((r) => r.matchedRule === "egress:vendor-only")).toBe(true);
  });

  it("stops DNS tunneling under the target policy but not on stock", () => {
    const stock = runScenario(makeEngine("stock-eth"), attackById("dns-tunnel")!, 0);
    expect(stock.every((r) => r.verdict === "allowed")).toBe(true);

    const target = runScenario(makeEngine("target-v1"), attackById("dns-tunnel")!, 0);
    expect(target.every((r) => r.verdict === "denied")).toBe(true);
  });

  it("demonstrates that allowlisted exfiltration succeeds on both firmwares", () => {
    const stock = runScenario(makeEngine("stock-eth"), attackById("vendor-exfil")!, 0);
    expect(stock.every((r) => r.verdict === "allowed")).toBe(true);

    const target = runScenario(makeEngine("target-v1"), attackById("vendor-exfil")!, 0);
    expect(target.every((r) => r.verdict === "allowed")).toBe(true);
    expect(target.every((r) => r.matchedRule === "egress:vendor-only")).toBe(true);
  });

  it("drops spoofed source addresses with the ingress check", () => {
    const results = runScenario(makeEngine("stock-eth"), attackById("spoofed-source")!, 0);
    expect(results[0].verdict).toBe("dropped");
    expect(results[0].matchedRule).toBe("ingress:source-check");
  });

  it("treats the non-IP flood as unfilterable stock traffic", () => {
    const results = runScenario(makeEngine("stock-eth"), attackById("mac-flood")!, 0);
    expect(results).toHaveLength(12);
    expect(results.every((r) => r.verdict === "allowed")).toBe(true);
    expect(results.every((r) => r.labels.some((l) => l.includes("non-IPv4")))).toBe(true);
  });

  it("advances the clock with the scenario and stays deterministic", () => {
    const a = makeEngine("stock-eth");
    const b = makeEngine("stock-eth");
    const ra = runScenario(a, attackById("c2-beacon")!, 0);
    const rb = runScenario(b, attackById("c2-beacon")!, 0);
    expect(ra.map((r) => r.verdict)).toEqual(rb.map((r) => r.verdict));
    expect(a.now).toBe(60000);
    expect(a.now).toBe(b.now);
  });
});
