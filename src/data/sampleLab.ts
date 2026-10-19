import type { DeviceModel, ProjectModel, ZoneModel } from "../engine/model";
import type { Flow } from "../engine/types";

const META = {
  id: "sample-home-iot-guest",
  name: "Home IoT guest lab",
  createdMs: 0,
  notes:
    "Default sample: Internet → home router → ESP32 router (LAN8720 uplink) → guest Wi-Fi 10.0.0.0/24 with three IoT devices." + " Addresses are schema-valid simulation values; public ranges follow RFC 5737."
};

const ZONES: ZoneModel[] = [
  { id: "internet", name: "Internet", cidr: null, description: "Public internet (simulated)." },
  { id: "upstream", name: "Upstream LAN", cidr: "192.168.1.0/24", description: "Home router LAN; performs NAT (double NAT)." },
  { id: "guest", name: "Guest Wi-Fi", cidr: "10.0.0.0/24", description: "SoftAP IoT guest network on the ESP32." },
  { id: "trusted", name: "Trusted LAN", cidr: "10.2.0.0/24", description: "Logical zone (not a physical port); disabled by default." },
  { id: "mgmt", name: "Management", cidr: "10.1.0.0/24", description: "Logical zone (not a physical port); disabled by default." }
];

function device(partial: Partial<DeviceModel> & Pick<DeviceModel, "id" | "name" | "role" | "zone" | "mac" | "ipv4">): DeviceModel {
  return {
    interfaceId: null,
    online: true,
    compromised: false,
    behaviorState: "normal",
    quarantined: false,
    isRouter: false,
    gateway: false,
    extraIps: [],
    services: [],
    trafficProfileId: "none",
    vendorEndpoints: [],
    egressPolicyId: "allow-all",
    managementPorts: [],
    notes: "",
    provenance: "assumption",
    ...partial
  };
}

export function buildSampleProject(): ProjectModel {
  return {
    schemaVersion: 1,
    meta: META,
    sim: {
      seed: 1337,
      boardId: "esp32-wroom-32d",
      adapterId: "lan8720",
      firmwareId: "stock-eth",
      policyBaseline: "P-B",
      publicIp: "203.0.113.7",
      dnsUpstream: "198.51.100.53",
      sinkholeEnabled: false,
      uplinkMbps: 100
    },
    zones: ZONES,
    interfaces: [
      {
        id: "wan0",
        name: "WAN (LAN8720)",
        zone: "upstream",
        kind: "ethernet",
        mac: "24:0a:c4:aa:bb:01",
        ipv4: "192.168.1.23",
        prefix: 24,
        up: true,
        dhcp: null
      },
      {
        id: "guest0",
        name: "IoT guest (SoftAP)",
        zone: "guest",
        kind: "wifi-ap",
        mac: "24:0a:c4:aa:bb:cc",
        ipv4: "10.0.0.1",
        prefix: 24,
        up: true,
        dhcp: { enabled: true, poolStart: "10.0.0.100", poolEnd: "10.0.0.149", leaseMs: 3600_000 }
      },
      {
        id: "trusted0",
        name: "Trusted LAN (logical)",
        zone: "trusted",
        kind: "logical",
        mac: "24:0a:c4:aa:bb:10",
        ipv4: "10.2.0.1",
        prefix: 24,
        up: false,
        dhcp: null
      },
      {
        id: "mgmt0",
        name: "Management (logical)",
        zone: "mgmt",
        kind: "logical",
        mac: "24:0a:c4:aa:bb:20",
        ipv4: "10.1.0.1",
        prefix: 24,
        up: false,
        dhcp: null
      }
    ],
    devices: [
      device({
        id: "internet",
        name: "Internet",
        role: "external",
        zone: "internet",
        mac: "00:00:5e:00:53:01",
        ipv4: "198.51.100.1",
        notes: "Documentation-range address (RFC 5737)."
      }),
      device({
        id: "attacker",
        name: "Attacker",
        role: "attacker",
        zone: "internet",
        mac: "00:00:5e:00:53:07",
        ipv4: "198.51.100.7",
        notes: "Remote attacker on the public internet."
      }),
      device({
        id: "vendor-cloud",
        name: "Vendor cloud",
        role: "external",
        zone: "internet",
        mac: "00:00:5e:00:53:65",
        ipv4: "203.0.113.65",
        notes: "Manufacturer cloud endpoint (simulation-assigned)."
      }),
      device({
        id: "c2",
        name: "C2 server",
        role: "attacker",
        zone: "internet",
        mac: "00:00:5e:00:53:66",
        ipv4: "203.0.113.66",
        notes: "Command-and-control server used by compromise scenarios."
      }),
      device({
        id: "dns-server",
        name: "DNS resolver",
        role: "infrastructure",
        zone: "internet",
        mac: "00:00:5e:00:53:53",
        ipv4: "203.0.113.53",
        services: [{ name: "dns", port: 53, protocol: "UDP" }],
        notes: "Recursive resolver on the public internet (simulation-assigned)."
      }),
      device({
        id: "ntp-pool",
        name: "NTP server",
        role: "infrastructure",
        zone: "internet",
        mac: "00:00:5e:00:53:7b",
        ipv4: "203.0.113.123",
        services: [{ name: "ntp", port: 123, protocol: "UDP" }],
        notes: "Public NTP server (simulation-assigned)."
      }),
      device({
        id: "home-router",
        name: "Home router",
        role: "infrastructure",
        zone: "upstream",
        mac: "f0:2f:74:11:22:33",
        ipv4: "192.168.1.1",
        gateway: true,
        managementPorts: [80],
        notes: "Upstream router performing NAT — public IP 203.0.113.7 (double NAT)."
      }),
      device({
        id: "esp32",
        name: "ESP32 router",
        role: "infrastructure",
        zone: "guest",
        mac: "24:0a:c4:aa:bb:cc",
        ipv4: "10.0.0.1",
        extraIps: ["192.168.1.23"],
        interfaceId: "guest0",
        isRouter: true,
        managementPorts: [80],
        notes: "Device under study: ESP32-WROOM-32D + LAN8720, SoftAP guest network."
      }),
      device({
        id: "cam",
        name: "IP camera",
        role: "iot",
        zone: "guest",
        mac: "3c:71:bf:00:00:11",
        ipv4: "10.0.0.11",
        interfaceId: "guest0",
        services: [
          { name: "rtsp", port: 554, protocol: "TCP" },
          { name: "onvif", port: 80, protocol: "TCP" },
          { name: "https", port: 443, protocol: "TCP" }
        ],
        trafficProfileId: "stream-camera",
        egressPolicyId: "vendor-only",
        vendorEndpoints: [{ ip: "203.0.113.65", protocol: "TCP", ports: [443, 8554], provenance: "assumption" }],
        demandMbps: 2.5,
        notes: "Sends video to the vendor cloud; egress policy: vendor-cloud only (target design). Configured demand 2.5 Mbps."
      }),
      device({
        id: "plug",
        name: "Smart plug",
        role: "iot",
        zone: "guest",
        mac: "3c:71:bf:00:00:12",
        ipv4: "10.0.0.12",
        interfaceId: "guest0",
        services: [{ name: "local-api", port: 80, protocol: "TCP" }],
        trafficProfileId: "telemetry-mqtt",
        egressPolicyId: "allow-all",
        capMbps: 0.04,
        notes: "Egress policy: allow all (sample baseline). Cap 0.04 Mbps configured below its 0.05 Mbps default demand — used to demonstrate over-cap accounting."
      }),
      device({
        id: "thermo",
        name: "Thermostat",
        role: "iot",
        zone: "guest",
        mac: "3c:71:bf:00:00:13",
        ipv4: "10.0.0.13",
        interfaceId: "guest0",
        services: [{ name: "local-api", port: 80, protocol: "TCP" }],
        trafficProfileId: "telemetry-mqtt",
        egressPolicyId: "block-all",
        notes: "Egress policy: block all (sample baseline — only enforceable under the stateful target dialect)."
      }),
      device({
        id: "trusted-laptop",
        name: "Trusted laptop",
        role: "infrastructure",
        zone: "trusted",
        mac: "8c:85:90:00:00:50",
        ipv4: "10.2.0.50",
        interfaceId: "trusted0",
        services: [],
        notes: "Trusted-zone device; the zone is disabled by default (no route)."
      }),
      device({
        id: "mgmt-ws",
        name: "Management workstation",
        role: "infrastructure",
        zone: "mgmt",
        mac: "8c:85:90:00:00:51",
        ipv4: "10.1.0.50",
        interfaceId: "mgmt0",
        services: [],
        notes: "Management-zone workstation; the zone is disabled by default (no route)."
      })
    ],
    routes: [
      {
        id: "default",
        dst: "0.0.0.0/0",
        via: "192.168.1.1",
        interfaceId: "wan0",
        kind: "default",
        enabled: true
      }
    ],
    firewall: {
      dialect: "stock-4list",
      defaultPolicy: "allow",
      stockAcl: { uplinkToGuest: [], guestToUplink: [], guestToGuest: [], uplinkLoop: [] },
      rules: []
    },
    portForwards: [
      {
        id: "gw-rtsp",
        name: "Home router → ESP32 (RTSP 8554)",
        enabled: false,
        routerId: "home-router",
        externalPort: 8554,
        protocol: "TCP",
        internalDeviceId: "esp32",
        internalPort: 8554,
        note: "Upstream leg of the double-NAT chain; must exist before the ESP32 forward can be reached."
      },
      {
        id: "esp-rtsp",
        name: "ESP32 → camera (RTSP 8554→554)",
        enabled: false,
        routerId: "esp32",
        externalPort: 8554,
        protocol: "TCP",
        internalDeviceId: "cam",
        internalPort: 554,
        note: "Exposes the camera RTSP service to the internet — attack surface increase (flag per spec §7)."
      }
    ],
    resources: {
      conntrackCapacity: 2048,
      naptCapacity: 2048,
      bufferCount: 32,
      txQueueLength: 16,
      ramOverrideKb: null
    }
  };
}

export function buildSampleFlows(): Flow[] {
  return [
    { id: "f1", label: "Camera → vendor cloud (TLS)", kind: "legit", timestampMs: 1000, srcDeviceId: "cam", dstDeviceId: "vendor-cloud", protocol: "TCP", srcPort: 41000, dstPort: 443 },
    { id: "f2", label: "Camera → C2 server (beacon)", kind: "attack", timestampMs: 2000, srcDeviceId: "cam", dstDeviceId: "c2", protocol: "TCP", srcPort: 41001, dstPort: 8443 },
    { id: "f3", label: "Smart plug → Thermostat (lateral probe)", kind: "attack", timestampMs: 3000, srcDeviceId: "plug", dstDeviceId: "thermo", protocol: "TCP", srcPort: 41002, dstPort: 80 },
    { id: "f4", label: "Attacker → camera (inbound RTSP)", kind: "inbound", timestampMs: 4000, srcDeviceId: "attacker", dstDeviceId: "cam", protocol: "TCP", srcPort: 51000, dstPort: 554 },
    { id: "f5", label: "Smart plug → ESP32 web UI (mgmt probe)", kind: "mgmt", timestampMs: 5000, srcDeviceId: "plug", dstDeviceId: "esp32", protocol: "TCP", srcPort: 41003, dstPort: 80 },
    { id: "f6", label: "Smart plug → ESP32 (ARP who-has)", kind: "l2", timestampMs: 6000, srcDeviceId: "plug", dstDeviceId: "esp32", protocol: "ARP", srcPort: null, dstPort: null },
    { id: "f7", label: "Smart plug → trusted laptop (guest→trusted)", kind: "attack", timestampMs: 7000, srcDeviceId: "plug", dstDeviceId: "trusted-laptop", protocol: "TCP", srcPort: 41004, dstPort: 22 }
  ];
}
