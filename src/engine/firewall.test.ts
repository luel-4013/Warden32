import { describe, expect, it } from "vitest";
import {
  evaluateStatefulRules,
  evaluateStockAclList,
  formatStockAclEntry,
  matchRule,
  parseStockAclLine,
  type RuleEvalContext
} from "./firewall";
import type { AclEntryModel, RuleModel } from "./model";
import type { ConnState } from "./types";

function makeRule(overrides: Partial<RuleModel>): RuleModel {
  return {
    id: "r1",
    name: "rule one",
    enabled: true,
    src: "any",
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
    rateLimitPerSec: null,
    description: "",
    ...overrides
  };
}

function makeCtx(overrides: Partial<RuleEvalContext> = {}): RuleEvalContext {
  return {
    protocol: "TCP",
    srcIp: "10.0.0.11",
    dstIp: "203.0.113.65",
    srcPort: 41000,
    dstPort: 443,
    srcZone: "guest",
    dstZone: "internet",
    inInterface: "guest0",
    outInterface: "wan0",
    connState: "NEW",
    devices: [],
    ...overrides
  };
}

describe("stateful rule evaluation", () => {
  it("returns the first matching rule in order", () => {
    const rules = [
      makeRule({ id: "deny-https", name: "deny https", protocol: "TCP", dstPorts: [443, 443], action: "drop" }),
      makeRule({ id: "allow-all", name: "allow all", action: "accept" })
    ];
    const decision = evaluateStatefulRules(rules, makeCtx(), "deny");
    expect(decision.action).toBe("drop");
    expect(decision.matchedRuleId).toBe("deny-https");
  });

  it("skips disabled rules", () => {
    const rules = [
      makeRule({ id: "disabled", enabled: false, action: "drop" }),
      makeRule({ id: "allow-all", action: "accept" })
    ];
    const decision = evaluateStatefulRules(rules, makeCtx(), "deny");
    expect(decision.matchedRuleId).toBe("allow-all");
    expect(decision.trace[0].result).toBe("skip");
    expect(decision.trace[0].reason).toBe("rule disabled");
  });

  it("matches ports, protocols, zones, and interfaces", () => {
    const rule = makeRule({ protocol: "UDP", dstPorts: [53, 53], dstZone: "internet", inInterface: "guest0" });
    expect(matchRule(rule, makeCtx({ protocol: "UDP", dstPort: 53 })).matched).toBe(true);
    expect(matchRule(rule, makeCtx({ protocol: "UDP", dstPort: 54 })).matched).toBe(false);
    expect(matchRule(rule, makeCtx({ protocol: "TCP", dstPort: 53 })).matched).toBe(false);
    expect(matchRule(rule, makeCtx({ protocol: "UDP", dstPort: 53, dstZone: "upstream" })).matched).toBe(false);
    expect(matchRule(rule, makeCtx({ protocol: "UDP", dstPort: 53, inInterface: "trusted0" })).matched).toBe(false);
  });

  it("honors connection state restrictions", () => {
    const rule = makeRule({ connStates: ["ESTABLISHED"] as ConnState[] });
    expect(matchRule(rule, makeCtx({ connState: "NEW" })).matched).toBe(false);
    expect(matchRule(rule, makeCtx({ connState: "ESTABLISHED" })).matched).toBe(true);
    expect(matchRule(rule, makeCtx({ connState: null })).matched).toBe(false);
  });

  it("falls back to the default policy when no rule matches", () => {
    const deny = evaluateStatefulRules([makeRule({ protocol: "UDP" })], makeCtx(), "deny");
    expect(deny.action).toBe("drop");
    expect(deny.matchedRuleId).toBeNull();
    expect(deny.ruleLabel).toContain("default policy (deny)");

    const allow = evaluateStatefulRules([makeRule({ protocol: "UDP" })], makeCtx(), "allow");
    expect(allow.action).toBe("allow");
    expect(allow.matchedRuleId).toBeNull();
  });
});

describe("stock ACL evaluation", () => {
  const entry: AclEntryModel = {
    id: "a1",
    protocol: "tcp",
    portFrom: 8554,
    portTo: 8554,
    target: "0.0.0.0/0",
    action: "allow"
  };

  it("matches protocol, port, and remote address", () => {
    const decision = evaluateStockAclList([entry], "TCP", 8554, "198.51.100.7");
    expect(decision.action).toBe("allow");
    expect(decision.matchedRuleId).toBe("a1");
  });

  it("skips entries that do not match and defaults to allow", () => {
    const wrongPort = evaluateStockAclList([entry], "TCP", 443, "198.51.100.7");
    expect(wrongPort.matchedRuleId).toBeNull();
    expect(wrongPort.action).toBe("allow");

    const wrongProto = evaluateStockAclList([entry], "UDP", 8554, "198.51.100.7");
    expect(wrongProto.matchedRuleId).toBeNull();
  });

  it("honors a drop entry before the default allow", () => {
    const drop: AclEntryModel = { ...entry, id: "a2", action: "drop", portFrom: 22, portTo: 22, protocol: "any" };
    const decision = evaluateStockAclList([drop], "TCP", 22, "198.51.100.7");
    expect(decision.action).toBe("drop");
    expect(decision.matchedRuleId).toBe("a2");
  });
});

describe("stock ACL line parsing", () => {
  it("parses the documented proto/port-port/ip format", () => {
    const parsed = parseStockAclLine("tcp/8554-8554/0.0.0.0/0", "x1");
    expect(parsed.ok).toBe(true);
    expect(parsed.entry).not.toBeNull();
    expect(parsed.entry!.protocol).toBe("tcp");
    expect(parsed.entry!.portFrom).toBe(8554);
    expect(parsed.entry!.portTo).toBe(8554);
    expect(parsed.entry!.target).toBe("0.0.0.0/0");
  });

  it("parses single ports and host targets", () => {
    const parsed = parseStockAclLine("udp/53-53/203.0.113.53", "x2");
    expect(parsed.ok).toBe(true);
    expect(parsed.entry!.portFrom).toBe(53);
    expect(parsed.entry!.target).toBe("203.0.113.53");
  });

  it("rejects malformed lines with an error", () => {
    expect(parseStockAclLine("tcp/443", "x3").ok).toBe(false);
    expect(parseStockAclLine("tcp/90000-90001/0.0.0.0/0", "x4").ok).toBe(false);
    expect(parseStockAclLine("sctp/443-443/0.0.0.0/0", "x5").ok).toBe(false);
    expect(parseStockAclLine("tcp/443-443/not-an-ip", "x6").ok).toBe(false);
    expect(parseStockAclLine("", "x7").ok).toBe(false);
    expect(parseStockAclLine("# comment", "x8").ok).toBe(false);
  });

  it("round-trips through the formatter", () => {
    const entry: AclEntryModel = {
      id: "rt",
      protocol: "tcp",
      portFrom: 8000,
      portTo: 8080,
      target: "203.0.113.0/24",
      action: "allow"
    };
    const line = formatStockAclEntry(entry);
    expect(line).toBe("tcp/8000-8080/203.0.113.0/24");
    const parsed = parseStockAclLine(line, "rt2");
    expect(parsed.ok).toBe(true);
    expect(parsed.entry).toMatchObject({
      protocol: "tcp",
      portFrom: 8000,
      portTo: 8080,
      target: "203.0.113.0/24"
    });
  });
});
