import type { Protocol, Provenance } from "./types";
import type { FirmwareProfileId } from "../registry/profiles";

export type ZoneId = "internet" | "upstream" | "guest" | "mgmt" | "trusted";

export type EgressPolicyId = "vendor-only" | "allow-all" | "block-all";

export interface VendorEndpoint {
  ip: string;
  protocol: "TCP" | "UDP";
  ports: number[];
  provenance: Provenance;
}

export interface ServiceDef {
  name: string;
  port: number;
  protocol: "TCP" | "UDP";
}

export interface ZoneModel {
  id: ZoneId;
  name: string;
  cidr: string | null;
  description: string;
}

export type InterfaceKind = "ethernet" | "wifi-ap" | "logical";

export interface DhcpConfig {
  enabled: boolean;
  poolStart: string;
  poolEnd: string;
  leaseMs: number;
}

export interface InterfaceModel {
  id: string;
  name: string;
  zone: ZoneId;
  kind: InterfaceKind;
  mac: string;
  ipv4: string | null;
  prefix: number;
  up: boolean;
  dhcp: DhcpConfig | null;
}

export type DeviceRole = "iot" | "infrastructure" | "external" | "attacker";

export interface TrafficProfileRef {
  profileId: string;
}

export type BehaviorState = "normal" | "noisy" | "misconfigured";

export interface DeviceModel {
  id: string;
  name: string;
  role: DeviceRole;
  zone: ZoneId;
  mac: string;
  ipv4: string | null;
  interfaceId: string | null;
  online: boolean;
  compromised: boolean;
  behaviorState: BehaviorState;
  quarantined: boolean;
  isRouter: boolean;
  gateway: boolean;
  extraIps: string[];
  services: ServiceDef[];
  trafficProfileId: string;
  vendorEndpoints: VendorEndpoint[];
  egressPolicyId: EgressPolicyId;
  managementPorts: number[];
  notes: string;
  provenance: Provenance;
  demandMbps?: number | null;
  capMbps?: number | null;
}

export interface RouteModel {
  id: string;
  dst: string;
  via: string | null;
  interfaceId: string;
  kind: "connected" | "default" | "static";
  enabled: boolean;
}

export type RuleAction = "accept" | "drop" | "reject";

export interface RuleModel {
  id: string;
  name: string;
  enabled: boolean;
  src: string;
  dst: string;
  srcZone: ZoneId | "any";
  dstZone: ZoneId | "any";
  protocol: "any" | Protocol;
  srcPorts: [number, number] | null;
  dstPorts: [number, number] | null;
  inInterface: string;
  outInterface: string;
  connStates: import("./types").ConnState[] | null;
  action: RuleAction;
  log: boolean;
  rateLimitPerSec: number | null;
  description: string;
}

export interface AclEntryModel {
  id: string;
  protocol: "tcp" | "udp" | "icmp" | "any";
  portFrom: number | null;
  portTo: number | null;
  target: string;
  action: "allow" | "drop";
}

export interface StockAclModel {
  uplinkToGuest: AclEntryModel[];
  guestToUplink: AclEntryModel[];
  guestToGuest: AclEntryModel[];
  uplinkLoop: AclEntryModel[];
}

export type FirewallDialect = "stock-4list" | "none" | "stateful";

export interface FirewallModel {
  dialect: FirewallDialect;
  defaultPolicy: "allow" | "deny";
  stockAcl: StockAclModel;
  rules: RuleModel[];
}

export interface PortForwardModel {
  id: string;
  name: string;
  enabled: boolean;
  routerId: string;
  externalPort: number;
  protocol: "TCP" | "UDP";
  internalDeviceId: string;
  internalPort: number;
  note: string;
}

export interface ResourceConfig {
  conntrackCapacity: number;
  naptCapacity: number;
  bufferCount: number;
  txQueueLength: number;
  ramOverrideKb: number | null;
}

export interface SimConfig {
  seed: number;
  boardId: string;
  adapterId: string;
  firmwareId: FirmwareProfileId;
  policyBaseline: "P-A" | "P-B" | "P-C" | "P-D";
  publicIp: string;
  dnsUpstream: string;
  sinkholeEnabled: boolean;
  uplinkMbps?: number;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdMs: number;
  notes: string;
}

export interface ProjectModel {
  schemaVersion: 1;
  meta: ProjectMeta;
  sim: SimConfig;
  zones: ZoneModel[];
  interfaces: InterfaceModel[];
  devices: DeviceModel[];
  routes: RouteModel[];
  firewall: FirewallModel;
  portForwards: PortForwardModel[];
  resources: ResourceConfig;
}
