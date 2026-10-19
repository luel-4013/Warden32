import { inSubnet, parseIPv4 } from "./address";
import type {
  AclEntryModel,
  DeviceModel,
  FirewallModel,
  RuleModel
} from "./model";
import type { ConnState, Protocol } from "./types";
import type { ZoneId } from "./model";

export interface RuleEvalContext {
  protocol: Protocol;
  srcIp: string;
  dstIp: string;
  srcPort: number | null;
  dstPort: number | null;
  srcZone: ZoneId;
  dstZone: ZoneId;
  inInterface: string;
  outInterface: string;
  connState: ConnState | null;
  devices: DeviceModel[];
}

export interface RuleTraceEntry {
  ruleId: string;
  name: string;
  result: "match" | "skip";
  reason: string;
}

export interface RuleDecision {
  action: "allow" | "drop" | "reject";
  matchedRuleId: string | null;
  ruleLabel: string;
  trace: RuleTraceEntry[];
}

function protocolMatches(ruleProtocol: RuleModel["protocol"], protocol: Protocol): boolean {
  if (ruleProtocol === "any") return true;
  return ruleProtocol === protocol;
}

function portInRange(range: [number, number] | null, port: number | null): boolean {
  if (range === null) return true;
  if (port === null) return false;
  return port >= range[0] && port <= range[1];
}

function addressMatches(target: string, ip: string, devices: DeviceModel[]): { ok: boolean; why: string } {
  if (target === "any") return { ok: true, why: "any" };
  const device = devices.find((d) => d.id === target);
  if (device) {
    const ips = [device.ipv4, ...device.extraIps].filter((x): x is string => x !== null);
    const ok = ips.includes(ip);
    return { ok, why: `device ${device.name} (${ips.join(", ") || "no address"})` };
  }
  if (target.includes("/")) {
    try {
      const ok = inSubnet(ip, target);
      return { ok, why: `subnet ${target}` };
    } catch {
      return { ok: false, why: `invalid subnet ${target}` };
    }
  }
  try {
    parseIPv4(target);
    return { ok: target === ip, why: `host ${target}` };
  } catch {
    return { ok: false, why: `unknown target ${target}` };
  }
}

export function matchRule(rule: RuleModel, ctx: RuleEvalContext): { matched: boolean; reason: string } {
  const checks: [boolean, string][] = [
    [protocolMatches(rule.protocol, ctx.protocol), `protocol ${rule.protocol}`],
    [rule.srcZone === "any" || rule.srcZone === ctx.srcZone, `src zone ${rule.srcZone}`],
    [rule.dstZone === "any" || rule.dstZone === ctx.dstZone, `dst zone ${rule.dstZone}`],
    [rule.inInterface === "any" || rule.inInterface === ctx.inInterface, `in ${rule.inInterface}`],
    [rule.outInterface === "any" || rule.outInterface === ctx.outInterface, `out ${rule.outInterface}`],
    [portInRange(rule.srcPorts, ctx.srcPort), `src ports ${rule.srcPorts ? rule.srcPorts.join("-") : "any"}`],
    [portInRange(rule.dstPorts, ctx.dstPort), `dst ports ${rule.dstPorts ? rule.dstPorts.join("-") : "any"}`],
    [
      rule.connStates === null || (ctx.connState !== null && rule.connStates.includes(ctx.connState)),
      `state ${rule.connStates ? rule.connStates.join("/") : "any"}`
    ]
  ];
  for (const [ok, label] of checks) {
    if (!ok) return { matched: false, reason: `skipped: ${label}` };
  }
  const srcMatch = addressMatches(rule.src, ctx.srcIp, ctx.devices);
  if (!srcMatch.ok) return { matched: false, reason: `skipped: src ${rule.src} != ${ctx.srcIp}` };
  const dstMatch = addressMatches(rule.dst, ctx.dstIp, ctx.devices);
  if (!dstMatch.ok) return { matched: false, reason: `skipped: dst ${rule.dst} != ${ctx.dstIp}` };
  return { matched: true, reason: `matched: ${rule.name}` };
}

export function evaluateStatefulRules(rules: RuleModel[], ctx: RuleEvalContext, defaultPolicy: "allow" | "deny"): RuleDecision {
  const trace: RuleTraceEntry[] = [];
  for (const rule of rules) {
    if (!rule.enabled) {
      trace.push({ ruleId: rule.id, name: rule.name, result: "skip", reason: "rule disabled" });
      continue;
    }
    const verdict = matchRule(rule, ctx);
    trace.push({ ruleId: rule.id, name: rule.name, result: verdict.matched ? "match" : "skip", reason: verdict.reason });
    if (verdict.matched) {
      return {
        action: rule.action === "accept" ? "allow" : rule.action,
        matchedRuleId: rule.id,
        ruleLabel: `${rule.name} → ${rule.action.toUpperCase()}`,
        trace
      };
    }
  }
  return {
    action: defaultPolicy === "allow" ? "allow" : "drop",
    matchedRuleId: null,
    ruleLabel: `default policy (${defaultPolicy})`,
    trace
  };
}

export function evaluateStockAclList(
  list: AclEntryModel[],
  protocol: Protocol,
  dstPort: number | null,
  remoteIp: string
): RuleDecision {
  const trace: RuleTraceEntry[] = [];
  for (const entry of list) {
    const protoText = entry.protocol === "any" ? "any" : entry.protocol;
    const name = `${protoText}${entry.portFrom !== null ? `/${entry.portFrom}-${entry.portTo}` : ""} ${entry.target}`;
    if (entry.protocol !== "any" && entry.protocol !== protocol.toLowerCase()) {
      trace.push({ ruleId: entry.id, name, result: "skip", reason: `protocol ${entry.protocol}` });
      continue;
    }
    if (entry.portFrom !== null && entry.portTo !== null) {
      if (dstPort === null || dstPort < entry.portFrom || dstPort > entry.portTo) {
        trace.push({ ruleId: entry.id, name, result: "skip", reason: `port ${dstPort ?? "none"} outside ${entry.portFrom}-${entry.portTo}` });
        continue;
      }
    }
    if (!inSubnet(remoteIp, entry.target)) {
      trace.push({ ruleId: entry.id, name, result: "skip", reason: `address ${remoteIp} not in ${entry.target}` });
      continue;
    }
    trace.push({ ruleId: entry.id, name, result: "match", reason: `matched ${name}` });
    return {
      action: entry.action === "allow" ? "allow" : "drop",
      matchedRuleId: entry.id,
      ruleLabel: `${entry.action.toUpperCase()} ${name}`,
      trace
    };
  }
  return {
    action: "allow",
    matchedRuleId: null,
    ruleLabel: "default policy — stock ACL allows when no rule matches",
    trace
  };
}

export function evaluateFirewall(firewall: FirewallModel, ctx: RuleEvalContext): RuleDecision {
  if (firewall.dialect === "none") {
    return {
      action: "allow",
      matchedRuleId: null,
      ruleLabel: "dialect none — no filtering configured",
      trace: []
    };
  }
  if (firewall.dialect === "stock-4list") {
    return evaluateStockAclList(firewall.stockAcl.guestToUplink, ctx.protocol, ctx.dstPort, ctx.dstIp);
  }
  return evaluateStatefulRules(firewall.rules, ctx, firewall.defaultPolicy);
}

export interface ParsedAclLine {
  ok: boolean;
  entry: AclEntryModel | null;
  error: string | null;
  warnings: string[];
}

export function parseStockAclLine(line: string, id: string): ParsedAclLine {
  const trimmed = line.trim();
  const warnings: string[] = [];
  if (trimmed === "" || trimmed.startsWith("#")) {
    return { ok: false, entry: null, error: "empty or comment line", warnings };
  }
  const parts = trimmed.split("/");
  if (parts.length < 3) {
    return {
      ok: false,
      entry: null,
      error: `expected <proto>/<port>-<port>/<ip|subnet>, got "${trimmed}"`,
      warnings
    };
  }
  const protoText = parts[0];
  const portText = parts[1];
  const targetText = parts.slice(2).join("/");
  const proto = protoText.toLowerCase();
  if (!["tcp", "udp", "icmp", "any", "*"].includes(proto)) {
    return { ok: false, entry: null, error: `unsupported protocol "${protoText}"`, warnings };
  }
  if (proto !== "tcp" && proto !== "udp" && proto !== "icmp") {
    warnings.push("stock firmware documents tcp/udp/icmp rules; other protocols are non-standard");
  }
  const portParts = portText.split("-");
  let portFrom: number | null = null;
  let portTo: number | null = null;
  if (portParts.length === 1) {
    portFrom = Number(portParts[0]);
    portTo = portFrom;
  } else if (portParts.length === 2) {
    portFrom = Number(portParts[0]);
    portTo = Number(portParts[1]);
  } else {
    return { ok: false, entry: null, error: `invalid port range "${portText}"`, warnings };
  }
  if (
    !Number.isInteger(portFrom) ||
    !Number.isInteger(portTo) ||
    portFrom < 0 ||
    portTo > 65535 ||
    portFrom > portTo
  ) {
    return { ok: false, entry: null, error: `invalid port range "${portText}"`, warnings };
  }
  let target = targetText.trim();
  if (target === "*" || target === "any") {
    target = "0.0.0.0/0";
  } else if (!target.includes("/")) {
    try {
      parseIPv4(target);
    } catch {
      return { ok: false, entry: null, error: `invalid address "${targetText}"`, warnings };
    }
  } else {
    try {
      inSubnet("0.0.0.0", target);
    } catch {
      return { ok: false, entry: null, error: `invalid subnet "${targetText}"`, warnings };
    }
  }
  return {
    ok: true,
    entry: {
      id,
      protocol: proto === "*" ? "any" : (proto as AclEntryModel["protocol"]),
      portFrom,
      portTo,
      target,
      action: "allow"
    },
    error: null,
    warnings
  };
}

export function formatStockAclEntry(entry: AclEntryModel): string {
  const proto = entry.protocol === "any" ? "any" : entry.protocol;
  const ports =
    entry.portFrom !== null && entry.portTo !== null ? `${entry.portFrom}-${entry.portTo}` : "0-65535";
  return `${proto}/${ports}/${entry.target}`;
}
