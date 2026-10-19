import type { EgressPolicyId, VendorEndpoint } from "./model";
import type { Protocol } from "./types";

export interface PolicyDecision {
  action: "allow" | "drop";
  matchedRule: string | null;
  ruleLabel: string;
}

export interface EgressContext {
  dstIp: string;
  dstPort: number | null;
  protocol: Protocol;
  vendorEndpoints: VendorEndpoint[];
}

export function evaluateDeviceEgress(policy: EgressPolicyId, ctx: EgressContext): PolicyDecision {
  if (policy === "allow-all") {
    return { action: "allow", matchedRule: "egress:allow-all", ruleLabel: "device egress: allow all" };
  }
  if (policy === "block-all") {
    return { action: "drop", matchedRule: "egress:block-all", ruleLabel: "device egress: block all" };
  }
  const match = ctx.vendorEndpoints.find(
    (ep) =>
      ep.ip === ctx.dstIp &&
      ep.protocol === ctx.protocol &&
      (ctx.dstPort === null || ep.ports.length === 0 || ep.ports.includes(ctx.dstPort))
  );
  if (match) {
    return {
      action: "allow",
      matchedRule: "egress:vendor-only",
      ruleLabel: `device egress: vendor-only — ${match.ip}`
    };
  }
  return {
    action: "drop",
    matchedRule: "egress:vendor-only",
    ruleLabel: `device egress: vendor-only — ${ctx.dstIp} is not a vendor endpoint`
  };
}
