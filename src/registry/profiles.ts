import type { Provenance } from "../engine/types";

export type FirmwareProfileId = "stock-eth" | "stock-wifi" | "softap-sta" | "target-v1";

export type AclDialect = "stock-4list" | "none" | "stateful-default-deny";

export interface FirmwareProfile {
  id: FirmwareProfileId;
  name: string;
  uplink: "ethernet" | "wifi";
  acl: AclDialect;
  defaultPolicy: "allow" | "deny";
  dnsSinkhole: boolean;
  clientIsolation: boolean;
  implementedOnHardware: boolean;
  managementChannels: string[];
  naptCapacity: number;
  note: string;
}

export const FIRMWARE_PROFILES: Record<FirmwareProfileId, FirmwareProfile> = {
  "stock-eth": {
    id: "stock-eth",
    name: "esp32_nat_router — Ethernet uplink (WT32-ETH01 target)",
    uplink: "ethernet",
    acl: "stock-4list",
    defaultPolicy: "allow",
    dnsSinkhole: false,
    clientIsolation: false,
    implementedOnHardware: true,
    managementChannels: ["web UI", "serial console", "TCP remote console", "mDNS", "MQTT", "MCP bridge", "OTA"],
    naptCapacity: 2048,
    note: "Stateless 4-list ACL, first-match, default-allow; non-IPv4 passes unfiltered."
  },
  "stock-wifi": {
    id: "stock-wifi",
    name: "esp32_nat_router — Wi-Fi STA uplink",
    uplink: "wifi",
    acl: "stock-4list",
    defaultPolicy: "allow",
    dnsSinkhole: false,
    clientIsolation: false,
    implementedOnHardware: true,
    managementChannels: ["web UI", "serial console", "TCP remote console", "mDNS", "MQTT", "MCP bridge", "OTA"],
    naptCapacity: 2048,
    note: "Same ACL semantics as the Ethernet build; uplink shares the radio (receive-then-forward half-duplex penalty)."
  },
  "softap-sta": {
    id: "softap-sta",
    name: "ESP-IDF softap_sta + NAPT (minimal baseline)",
    uplink: "wifi",
    acl: "none",
    defaultPolicy: "allow",
    dnsSinkhole: false,
    clientIsolation: false,
    implementedOnHardware: true,
    managementChannels: [],
    naptCapacity: 2048,
    note: "Official minimal example: pure forward/NAT with no filtering and no management surface."
  },
  "target-v1": {
    id: "target-v1",
    name: "Target design v1 (hypothetical hardening)",
    uplink: "ethernet",
    acl: "stateful-default-deny",
    defaultPolicy: "deny",
    dnsSinkhole: true,
    clientIsolation: false,
    implementedOnHardware: false,
    managementChannels: ["serial"],
    naptCapacity: 2048,
    note: "Simulation-only design: stateful 5-tuple, default-deny, egress allowlist, DNS sinkhole; not implemented on hardware."
  }
};

export interface HardwareProfile {
  id: string;
  name: string;
  cores: string;
  clockMhz: number;
  wifi: string | null;
  internalEmac: boolean;
  ethernetBus: string;
  ramKb: number;
  provenance: Provenance;
  note: string;
}

export const HARDWARE_PROFILES: HardwareProfile[] = [
  {
    id: "esp32-wroom-32d",
    name: "ESP32-WROOM-32D (owner devkit)",
    cores: "2× LX6",
    clockMhz: 240,
    wifi: "802.11 b/g/n",
    internalEmac: true,
    ethernetBus: "RMII",
    ramKb: 520,
    provenance: "datasheet",
    note: "Primary target; ~520 KB SRAM."
  },
  {
    id: "wt32-eth01",
    name: "WT32-ETH01",
    cores: "2× LX6",
    clockMhz: 240,
    wifi: "802.11 b/g/n",
    internalEmac: true,
    ethernetBus: "RMII",
    ramKb: 520,
    provenance: "datasheet",
    note: "Integrated LAN8720; matches the stock firmware's prebuilt Ethernet binary (PHY addr 1, clock from PHY, power GPIO 16)."
  },
  {
    id: "esp32-s2",
    name: "ESP32-S2",
    cores: "1× LX7",
    clockMhz: 240,
    wifi: "802.11 b/g/n",
    internalEmac: false,
    ethernetBus: "SPI only",
    ramKb: 320,
    provenance: "datasheet",
    note: "No internal EMAC; no BLE."
  },
  {
    id: "esp32-s3",
    name: "ESP32-S3",
    cores: "2× LX7",
    clockMhz: 240,
    wifi: "802.11 b/g/n",
    internalEmac: false,
    ethernetBus: "SPI only",
    ramKb: 512,
    provenance: "datasheet",
    note: "No internal EMAC."
  },
  {
    id: "esp32-c3",
    name: "ESP32-C3",
    cores: "1× RISC-V",
    clockMhz: 160,
    wifi: "802.11 b/g/n",
    internalEmac: false,
    ethernetBus: "SPI only",
    ramKb: 400,
    provenance: "datasheet",
    note: "Stock firmware caps ~5 clients; high-performance variant does not apply."
  },
  {
    id: "esp32-c6",
    name: "ESP32-C6",
    cores: "1× RISC-V",
    clockMhz: 160,
    wifi: "Wi-Fi 6 (2.4 GHz)",
    internalEmac: false,
    ethernetBus: "SPI only",
    ramKb: 512,
    provenance: "datasheet",
    note: "No internal EMAC."
  },
  {
    id: "esp32-p4",
    name: "ESP32-P4",
    cores: "2× RISC-V",
    clockMhz: 400,
    wifi: null,
    internalEmac: true,
    ethernetBus: "RMII",
    ramKb: 768,
    provenance: "datasheet",
    note: "No Wi-Fi radio; requires a companion chip — flag topology as unsupported unless modeled."
  },
  {
    id: "esp32-h2",
    name: "ESP32-H2",
    cores: "1× RISC-V",
    clockMhz: 96,
    wifi: null,
    internalEmac: false,
    ethernetBus: "none",
    ramKb: 320,
    provenance: "datasheet",
    note: "802.15.4 only — excluded from router topologies."
  }
];

export interface EthernetAdapter {
  id: string;
  name: string;
  bus: "RMII" | "SPI" | "RGMII" | "none";
  nominalMbps: number;
  cpuCostPerPacket: number;
  requiresInternalEmac: boolean;
  provenance: Provenance;
  note: string;
}

export const ETHERNET_ADAPTERS: EthernetAdapter[] = [
  {
    id: "lan8720",
    name: "LAN8720 (recommended)",
    bus: "RMII",
    nominalMbps: 100,
    cpuCostPerPacket: 1.0,
    requiresInternalEmac: true,
    provenance: "datasheet",
    note: "Only on EMAC chips (ESP32/P4/S31)."
  },
  {
    id: "ksz8081",
    name: "KSZ8081 / TLK110-class PHY",
    bus: "RMII",
    nominalMbps: 100,
    cpuCostPerPacket: 1.1,
    requiresInternalEmac: true,
    provenance: "estimate",
    note: "Same bus rule as LAN8720; PHY quirk differences."
  },
  {
    id: "w5500",
    name: "W5500",
    bus: "SPI",
    nominalMbps: 100,
    cpuCostPerPacket: 2.2,
    requiresInternalEmac: false,
    provenance: "estimate",
    note: "MACRAW mode required for routing; SPI throughput bottleneck; no IP fragmentation offload."
  },
  {
    id: "w5100",
    name: "W5100 (legacy)",
    bus: "SPI",
    nominalMbps: 10,
    cpuCostPerPacket: 3.0,
    requiresInternalEmac: false,
    provenance: "estimate",
    note: "Slowest of the WIZnet family."
  },
  {
    id: "dm9051",
    name: "DM9051",
    bus: "SPI",
    nominalMbps: 100,
    cpuCostPerPacket: 2.0,
    requiresInternalEmac: false,
    provenance: "estimate",
    note: "Budget 100 Mbps; still SPI-bound."
  },
  {
    id: "enc28j60",
    name: "ENC28J60",
    bus: "SPI",
    nominalMbps: 10,
    cpuCostPerPacket: 3.6,
    requiresInternalEmac: false,
    provenance: "datasheet",
    note: "10 Mbps hard limit; highest CPU cost per packet."
  },
  {
    id: "yt8531",
    name: "YT8531-class PHY",
    bus: "RGMII",
    nominalMbps: 1000,
    cpuCostPerPacket: 0.9,
    requiresInternalEmac: true,
    provenance: "datasheet",
    note: "Future chips only (S31/P4 class)."
  },
  {
    id: "none",
    name: "none — Wi-Fi STA uplink",
    bus: "none",
    nominalMbps: 54,
    cpuCostPerPacket: 1.6,
    requiresInternalEmac: false,
    provenance: "estimate",
    note: "Baseline comparison; exhibits the receive-then-forward half-duplex penalty."
  }
];
