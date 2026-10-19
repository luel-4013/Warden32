import type { ZoneId } from "./model";

export type Provenance = "measured" | "datasheet" | "paper" | "estimate" | "assumption";

export interface Tagged<T> {
  value: T;
  provenance: Provenance;
  source?: string;
}

export type Scope =
  | "internet-routed"
  | "lan-routed"
  | "guest-L2-peer"
  | "wifi-management"
  | "esp32-local";

export type EnforcementPoint = "l3-firewall" | "l2-driver" | "wifi-driver" | "none";

export type Protocol = "TCP" | "UDP" | "ICMP" | "ARP" | "IPv6" | "OTHER";

export type FlowVerdict = "allowed" | "denied" | "dropped" | "not-enforceable";

export type FlowKind = "legit" | "attack" | "mgmt" | "inbound" | "l2" | "traffic";

export interface Flow {
  id: string;
  label: string;
  kind: FlowKind;
  timestampMs: number;
  srcDeviceId: string;
  dstDeviceId: string;
  protocol: Protocol;
  srcPort: number | null;
  dstPort: number | null;
  spoofedSrcIp?: string | null;
  forcedConnState?: ConnState | null;
  bytes?: number;
  sampleOf?: number;
}

export interface NatHop {
  hostId: string;
  hostName: string;
  fromIp: string;
  fromPort: number | null;
  toIp: string;
  toPort: number | null;
}

export type ConnState = "NEW" | "ESTABLISHED" | "RELATED" | "INVALID" | "EXPIRED";

export type EventCategory =
  | "system"
  | "pipeline"
  | "firewall"
  | "nat"
  | "conntrack"
  | "routing"
  | "resource"
  | "traffic"
  | "attack"
  | "wifi"
  | "incident"
  | "metrics";

export type EventSeverity = "info" | "ok" | "warn" | "error";

export interface SimEvent {
  id: number;
  ts: number;
  category: EventCategory;
  severity: EventSeverity;
  message: string;
  flowId?: string;
  packetId?: number;
  deviceId?: string;
  data?: Record<string, string | number | boolean | null>;
  provenance: Provenance;
}

export interface FlowResult {
  flow: Flow;
  scope: Scope;
  visibleToFirewall: boolean;
  enforcementPoint: EnforcementPoint;
  verdict: FlowVerdict;
  reason: string;
  matchedRule: string | null;
  natChain: NatHop[];
  cpuCost: number;
  airtimeCost: number;
  labels: string[];
  events: SimEvent[];
  connState: ConnState | null;
  route: string | null;
}

export interface ZonePair {
  src: ZoneId;
  dst: ZoneId;
}
