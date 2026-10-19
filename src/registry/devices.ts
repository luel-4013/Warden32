import type { BehaviorState, EgressPolicyId, ServiceDef, VendorEndpoint } from "../engine/model";
import type { Provenance } from "../engine/types";

export type ArchetypeCategory = "iot" | "infrastructure" | "external";

export interface DeviceArchetype {
  id: string;
  name: string;
  category: ArchetypeCategory;
  services: ServiceDef[];
  managementPorts: number[];
  egressPolicyId: EgressPolicyId;
  vendorEndpoints: VendorEndpoint[];
  trafficProfileId: string;
  behaviorState: BehaviorState;
  notes: string;
  provenance: Provenance;
}

const DEMO_CLOUD: VendorEndpoint[] = [
  { ip: "203.0.113.65", protocol: "TCP", ports: [443, 8883, 8443], provenance: "assumption" }
];

export const DEVICE_ARCHETYPES: DeviceArchetype[] = [
  {
    id: "camera",
    name: "IP camera",
    category: "iot",
    services: [{ name: "RTSP", port: 554, protocol: "TCP" }, { name: "onvif", port: 80, protocol: "TCP" }],
    managementPorts: [80],
    egressPolicyId: "vendor-only",
    vendorEndpoints: DEMO_CLOUD,
    trafficProfileId: "stream-camera",
    behaviorState: "normal",
    notes: "Continuous video uplink dominates airtime; historically the noisiest IoT device class.",
    provenance: "paper"
  },
  {
    id: "doorbell",
    name: "Video doorbell",
    category: "iot",
    services: [{ name: "RTSP", port: 554, protocol: "TCP" }],
    managementPorts: [],
    egressPolicyId: "vendor-only",
    vendorEndpoints: DEMO_CLOUD,
    trafficProfileId: "stream-camera",
    behaviorState: "normal",
    notes: "Bursty event video plus periodic frames; event-driven wake pattern.",
    provenance: "paper"
  },
  {
    id: "plug",
    name: "Smart plug",
    category: "iot",
    services: [{ name: "http", port: 80, protocol: "TCP" }],
    managementPorts: [80],
    egressPolicyId: "allow-all",
    vendorEndpoints: [],
    trafficProfileId: "telemetry-mqtt",
    behaviorState: "normal",
    notes: "Small MQTT telemetry; many stock plugs run an unfiltered http server on port 80.",
    provenance: "paper"
  },
  {
    id: "bulb",
    name: "Smart bulb",
    category: "iot",
    services: [],
    managementPorts: [],
    egressPolicyId: "vendor-only",
    vendorEndpoints: DEMO_CLOUD,
    trafficProfileId: "telemetry-mqtt",
    behaviorState: "normal",
    notes: "Low-rate telemetry only; frequently dials vendor cloud even when idle.",
    provenance: "paper"
  },
  {
    id: "thermostat",
    name: "Thermostat",
    category: "iot",
    services: [],
    managementPorts: [],
    egressPolicyId: "vendor-only",
    vendorEndpoints: DEMO_CLOUD,
    trafficProfileId: "telemetry-mqtt",
    behaviorState: "normal",
    notes: "Periodic state sync plus NTP; a candidate for strict vendor-only egress.",
    provenance: "paper"
  },
  {
    id: "sensor",
    name: "Environment sensor",
    category: "iot",
    services: [],
    managementPorts: [],
    egressPolicyId: "vendor-only",
    vendorEndpoints: DEMO_CLOUD,
    trafficProfileId: "sensor-small",
    behaviorState: "normal",
    notes: "Smallest footprint of the library; battery-class reporting cadence.",
    provenance: "paper"
  },
  {
    id: "hub",
    name: "Home hub / bridge",
    category: "iot",
    services: [{ name: "zigbee-http", port: 80, protocol: "TCP" }],
    managementPorts: [80],
    egressPolicyId: "vendor-only",
    vendorEndpoints: DEMO_CLOUD,
    trafficProfileId: "hub-aggregator",
    behaviorState: "normal",
    notes: "Aggregates device telemetry; talks to many local peers, so it is the noisiest lateral talker.",
    provenance: "paper"
  },
  {
    id: "speaker",
    name: "Smart speaker / display",
    category: "iot",
    services: [{ name: "cast", port: 8009, protocol: "TCP" }],
    managementPorts: [],
    egressPolicyId: "vendor-only",
    vendorEndpoints: DEMO_CLOUD,
    trafficProfileId: "stream-media",
    behaviorState: "normal",
    notes: "Media chunks with standby polling; large upstream bursts when streaming.",
    provenance: "paper"
  },
  {
    id: "tv",
    name: "Smart TV / streaming stick",
    category: "iot",
    services: [{ name: "cast", port: 8009, protocol: "TCP" }],
    managementPorts: [],
    egressPolicyId: "vendor-only",
    vendorEndpoints: DEMO_CLOUD,
    trafficProfileId: "stream-media",
    behaviorState: "normal",
    notes: "Highest-volume consumer in the library; also fingerprints locally.",
    provenance: "paper"
  },
  {
    id: "vacuum",
    name: "Robot vacuum",
    category: "iot",
    services: [],
    managementPorts: [],
    egressPolicyId: "vendor-only",
    vendorEndpoints: DEMO_CLOUD,
    trafficProfileId: "appliance-burst",
    behaviorState: "normal",
    notes: "Sparse control traffic plus large map uploads after cleaning runs.",
    provenance: "paper"
  },
  {
    id: "appliance",
    name: "Large appliance",
    category: "iot",
    services: [],
    managementPorts: [],
    egressPolicyId: "vendor-only",
    vendorEndpoints: DEMO_CLOUD,
    trafficProfileId: "appliance-burst",
    behaviorState: "normal",
    notes: "Firmware-check bursts and diagnostics uploads.",
    provenance: "paper"
  },
  {
    id: "lock",
    name: "Smart door lock",
    category: "iot",
    services: [],
    managementPorts: [],
    egressPolicyId: "vendor-only",
    vendorEndpoints: DEMO_CLOUD,
    trafficProfileId: "lock-event",
    behaviorState: "normal",
    notes: "Event-driven: silent until an unlock event, then a burst to the vendor.",
    provenance: "paper"
  },
  {
    id: "feeder",
    name: "Pet feeder",
    category: "iot",
    services: [],
    managementPorts: [],
    egressPolicyId: "vendor-only",
    vendorEndpoints: DEMO_CLOUD,
    trafficProfileId: "telemetry-mqtt",
    behaviorState: "normal",
    notes: "Timer-driven telemetry; occasional camera-less event reports.",
    provenance: "paper"
  },
  {
    id: "scale",
    name: "Smart scale",
    category: "iot",
    services: [],
    managementPorts: [],
    egressPolicyId: "vendor-only",
    vendorEndpoints: DEMO_CLOUD,
    trafficProfileId: "sensor-small",
    behaviorState: "normal",
    notes: "Very low duty cycle; uploads only after a measurement.",
    provenance: "paper"
  },
  {
    id: "generic-embedded",
    name: "Generic embedded device",
    category: "iot",
    services: [],
    managementPorts: [],
    egressPolicyId: "allow-all",
    vendorEndpoints: [],
    trafficProfileId: "generic-embedded",
    behaviorState: "normal",
    notes: "Catch-all for unclassified firmware; keepalive-only baseline.",
    provenance: "assumption"
  },
  {
    id: "router-upstream",
    name: "Upstream router",
    category: "infrastructure",
    services: [{ name: "mgmt", port: 80, protocol: "TCP" }],
    managementPorts: [80],
    egressPolicyId: "allow-all",
    vendorEndpoints: [],
    trafficProfileId: "none",
    behaviorState: "normal",
    notes: "Performs the outer NAT; all inbound reachability depends on its forwards.",
    provenance: "assumption"
  },
  {
    id: "dns-server",
    name: "DNS resolver",
    category: "infrastructure",
    services: [{ name: "dns", port: 53, protocol: "UDP" }, { name: "dns-tcp", port: 53, protocol: "TCP" }],
    managementPorts: [],
    egressPolicyId: "allow-all",
    vendorEndpoints: [],
    trafficProfileId: "none",
    behaviorState: "normal",
    notes: "Answers guest DNS after NAT; a common exfiltration channel when abused.",
    provenance: "assumption"
  },
  {
    id: "ntp-pool",
    name: "NTP server",
    category: "infrastructure",
    services: [{ name: "ntp", port: 123, protocol: "UDP" }],
    managementPorts: [],
    egressPolicyId: "allow-all",
    vendorEndpoints: [],
    trafficProfileId: "none",
    behaviorState: "normal",
    notes: "Clock synchronization; small periodic exchanges.",
    provenance: "assumption"
  },
  {
    id: "cloud-api",
    name: "Vendor cloud",
    category: "external",
    services: [{ name: "https", port: 443, protocol: "TCP" }, { name: "mqtts", port: 8883, protocol: "TCP" }],
    managementPorts: [],
    egressPolicyId: "allow-all",
    vendorEndpoints: [],
    trafficProfileId: "none",
    behaviorState: "normal",
    notes: "Destination host for legitimate device traffic.",
    provenance: "assumption"
  },
  {
    id: "attacker-host",
    name: "External attacker",
    category: "external",
    services: [],
    managementPorts: [],
    egressPolicyId: "allow-all",
    vendorEndpoints: [],
    trafficProfileId: "none",
    behaviorState: "normal",
    notes: "Source of inbound scans/exploits; used by attack scenarios.",
    provenance: "assumption"
  },
  {
    id: "c2-server",
    name: "C2 server",
    category: "external",
    services: [{ name: "beacon", port: 8443, protocol: "TCP" }],
    managementPorts: [],
    egressPolicyId: "allow-all",
    vendorEndpoints: [],
    trafficProfileId: "none",
    behaviorState: "normal",
    notes: "Command-and-control endpoint for compromised devices.",
    provenance: "assumption"
  },
  {
    id: "trusted-laptop",
    name: "Trusted laptop",
    category: "iot",
    services: [{ name: "ssh", port: 22, protocol: "TCP" }],
    managementPorts: [22],
    egressPolicyId: "allow-all",
    vendorEndpoints: [],
    trafficProfileId: "none",
    behaviorState: "normal",
    notes: "Simulates the trusted LAN on the logical trusted zone; disabled by default.",
    provenance: "assumption"
  },
  {
    id: "mgmt-workstation",
    name: "Management workstation",
    category: "iot",
    services: [],
    managementPorts: [],
    egressPolicyId: "allow-all",
    vendorEndpoints: [],
    trafficProfileId: "none",
    behaviorState: "normal",
    notes: "Administrative host on the logical management zone; disabled by default.",
    provenance: "assumption"
  }
];

export function archetypeById(id: string): DeviceArchetype | null {
  return DEVICE_ARCHETYPES.find((archetype) => archetype.id === id) ?? null;
}

export function iotArchetypes(): DeviceArchetype[] {
  return DEVICE_ARCHETYPES.filter((archetype) => archetype.category === "iot");
}
