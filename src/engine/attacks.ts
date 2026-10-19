import type { SimEngine } from "./engine";
import type { ProjectModel } from "./model";
import type { Flow, FlowResult, Provenance } from "./types";

export type AttackCategory =
  | "recon"
  | "initial-access"
  | "lateral"
  | "c2"
  | "exfiltration"
  | "spoofing"
  | "dos";

export interface AttackScenario {
  id: string;
  name: string;
  category: AttackCategory;
  description: string;
  modeled: boolean;
  provenance: Provenance;
  build: (project: ProjectModel, startMs: number) => Flow[];
}

function hasDevice(project: ProjectModel, id: string): boolean {
  return project.devices.some((device) => device.id === id);
}

function flow(
  id: string,
  label: string,
  kind: Flow["kind"],
  timestampMs: number,
  srcDeviceId: string,
  dstDeviceId: string,
  protocol: Flow["protocol"],
  srcPort: number | null,
  dstPort: number | null,
  extra?: Partial<Flow>
): Flow {
  return { id, label, kind, timestampMs, srcDeviceId, dstDeviceId, protocol, srcPort, dstPort, ...extra };
}

export const ATTACK_SCENARIOS: AttackScenario[] = [
  {
    id: "recon-port-scan",
    name: "Inbound port scan",
    category: "recon",
    description: "External attacker scans common IoT ports through the public IP. NAT blocks everything without a forward.",
    modeled: true,
    provenance: "assumption",
    build: (project, startMs) => {
      if (!hasDevice(project, "attacker") || !hasDevice(project, "cam")) return [];
      const ports = [22, 80, 554, 8554, 23];
      return ports.map((port, index) =>
        flow(
          `scan-${port}`,
          `Port scan — attacker → camera:${port}`,
          "inbound",
          startMs + index * 250,
          "attacker",
          "cam",
          "TCP",
          52000 + index,
          port
        )
      );
    }
  },
  {
    id: "initial-rtsp-exploit",
    name: "RTSP exploit attempt",
    category: "initial-access",
    description: "Exploit probe against the camera RTSP service; only reachable when both routers forward the port.",
    modeled: true,
    provenance: "assumption",
    build: (project, startMs) => {
      if (!hasDevice(project, "attacker") || !hasDevice(project, "cam")) return [];
      return [
        flow("rtsp-exploit-1", "RTSP exploit probe", "inbound", startMs, "attacker", "cam", "TCP", 53000, 8554),
        flow("rtsp-exploit-2", "RTSP exploit follow-up", "inbound", startMs + 1200, "attacker", "cam", "TCP", 53001, 8554)
      ];
    }
  },
  {
    id: "mgmt-http-probe",
    name: "ESP32 management probe",
    category: "initial-access",
    description: "Guest device probes the ESP32 web UI. Allowed on stock (no local-input ACL), denied by the target design.",
    modeled: true,
    provenance: "measured",
    build: (project, startMs) => {
      if (!hasDevice(project, "plug") || !hasDevice(project, "esp32")) return [];
      return [flow("mgmt-probe-1", "ESP32 web UI probe", "mgmt", startMs, "plug", "esp32", "TCP", 54000, 80)];
    }
  },
  {
    id: "lateral-probe",
    name: "Lateral service probe",
    category: "lateral",
    description:
      "One guest device probes another. On stock firmware the Wi-Fi driver relays the frames — no isolation, not enforceable (§3).",
    modeled: true,
    provenance: "measured",
    build: (project, startMs) => {
      if (!hasDevice(project, "plug") || !hasDevice(project, "thermo")) return [];
      const ports = [80, 22, 23];
      return ports.map((port, index) =>
        flow(
          `lateral-${port}`,
          `Lateral probe — plug → thermostat:${port}`,
          "attack",
          startMs + index * 400,
          "plug",
          "thermo",
          "TCP",
          55000 + index,
          port
        )
      );
    }
  },
  {
    id: "lateral-arp-spoof",
    name: "ARP spoofing attempt",
    category: "spoofing",
    description:
      "Guest device sends forged ARP replies. ARP is relayed by the Wi-Fi driver and never reaches lwIP — cannot be blocked on stock.",
    modeled: true,
    provenance: "measured",
    build: (project, startMs) => {
      if (!hasDevice(project, "plug") || !hasDevice(project, "cam")) return [];
      return [
        flow("arp-spoof-1", "ARP reply claiming gateway", "l2", startMs, "plug", "cam", "ARP", null, null),
        flow("arp-spoof-2", "ARP reply claiming gateway (repeat)", "l2", startMs + 900, "plug", "cam", "ARP", null, null)
      ];
    }
  },
  {
    id: "c2-beacon",
    name: "C2 beaconing",
    category: "c2",
    description: "Compromised camera beacons to command-and-control. Allowed on stock (default allow), denied by target vendor-only egress.",
    modeled: true,
    provenance: "assumption",
    build: (project, startMs) => {
      if (!hasDevice(project, "cam") || !hasDevice(project, "c2")) return [];
      return [0, 1, 2].map((index) =>
        flow(
          `beacon-${index}`,
          "C2 beacon",
          "attack",
          startMs + index * 30000,
          "cam",
          "c2",
          "TCP",
          56000 + index,
          8443
        )
      );
    }
  },
  {
    id: "dns-tunnel",
    name: "DNS tunneling",
    category: "exfiltration",
    description: "Oversized DNS queries to a resolver; vendor-only egress (target) denies them, stock allows them.",
    modeled: true,
    provenance: "assumption",
    build: (project, startMs) => {
      if (!hasDevice(project, "cam") || !hasDevice(project, "dns-server")) return [];
      return [0, 1, 2, 3].map((index) =>
        flow(
          `dnstunnel-${index}`,
          "DNS tunnel query",
          "attack",
          startMs + index * 15000,
          "cam",
          "dns-server",
          "UDP",
          57000 + index,
          53
        )
      );
    }
  },
  {
    id: "vendor-exfil",
    name: "Exfiltration to vendor cloud",
    category: "exfiltration",
    description:
      "Stolen data uploaded to the legitimate vendor endpoint. Vendor-only allowlists cannot stop this — egress policy limits destinations, not intent.",
    modeled: true,
    provenance: "assumption",
    build: (project, startMs) => {
      if (!hasDevice(project, "cam") || !hasDevice(project, "vendor-cloud")) return [];
      return [0, 1, 2, 3, 4, 5].map((index) =>
        flow(
          `vendor-exfil-${index}`,
          "Large upload to vendor cloud",
          "attack",
          startMs + index * 500,
          "cam",
          "vendor-cloud",
          "TCP",
          58000 + index,
          443
        )
      );
    }
  },
  {
    id: "spoofed-source",
    name: "Spoofed source address",
    category: "spoofing",
    description:
      "Attacker claims the vendor cloud's address. Visible to the firewall (routed WAN side) and dropped by the ingress source check.",
    modeled: true,
    provenance: "assumption",
    build: (project, startMs) => {
      if (!hasDevice(project, "attacker") || !hasDevice(project, "cam")) return [];
      return [
        flow("spoof-1", "Spoofed inbound packet", "attack", startMs, "attacker", "cam", "TCP", 59000, 554, {
          spoofedSrcIp: "203.0.113.65"
        })
      ];
    }
  },
  {
    id: "mac-flood",
    name: "MAC/association flood",
    category: "dos",
    description:
      "Non-IPv4 flood consumes airtime in the Wi-Fi driver; lwIP never sees the frames, so no ACL can rate-limit them on stock.",
    modeled: true,
    provenance: "estimate",
    build: (project, startMs) => {
      if (!hasDevice(project, "plug") || !hasDevice(project, "esp32")) return [];
      return Array.from({ length: 12 }, (_, index) =>
        flow(
          `flood-${index}`,
          "Non-IP flood frame",
          "l2",
          startMs + index * 50,
          "plug",
          "esp32",
          "OTHER",
          null,
          null
        )
      );
    }
  },
  {
    id: "wifi-deauth",
    name: "802.11 deauthentication flood",
    category: "dos",
    description:
      "Not modeled: deauth frames are radio-layer management frames and never reach the IP stack. Listed for completeness — the lab cannot simulate them honestly without a radio model.",
    modeled: false,
    provenance: "measured",
    build: () => []
  },
  {
    id: "dhcp-starvation",
    name: "DHCP pool exhaustion",
    category: "dos",
    description:
      "Not modeled: DHCP is served inside the Wi-Fi stack (L2, below lwIP); the lab has no DHCP server model and will not fake one.",
    modeled: false,
    provenance: "measured",
    build: () => []
  }
];

export function attackById(id: string): AttackScenario | null {
  return ATTACK_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}

export function runScenario(engine: SimEngine, scenario: AttackScenario, startMs?: number): FlowResult[] {
  const begin = startMs ?? engine.now;
  return scenario.build(engine.project, begin).map((attackFlow) => {
    engine.advanceTo(attackFlow.timestampMs);
    return engine.submitFlow(attackFlow);
  });
}
