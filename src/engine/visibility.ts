import type { Protocol } from "./types";
import type { ZoneId } from "./model";

export interface Classification {
  scope: "internet-routed" | "lan-routed" | "guest-L2-peer" | "wifi-management" | "esp32-local";
  visibleToFirewall: boolean;
  enforcementPoint: "l3-firewall" | "l2-driver" | "wifi-driver" | "none";
  reason: string;
}

export function classifyFlow(
  srcZone: ZoneId,
  dstZone: ZoneId,
  dstIsRouter: boolean,
  protocol: Protocol
): Classification {
  if (dstIsRouter) {
    return {
      scope: "esp32-local",
      visibleToFirewall: true,
      enforcementPoint: "l3-firewall",
      reason:
        srcZone === "guest"
          ? "delivered to the ESP32 IP stack over the SoftAP interface"
          : "delivered to the ESP32 IP stack over the WAN interface"
    };
  }
  if (protocol === "OTHER") {
    return {
      scope: "wifi-management",
      visibleToFirewall: false,
      enforcementPoint: "wifi-driver",
      reason:
        "802.11 management frame handled inside the closed-source Wi-Fi library; never reaches lwIP"
    };
  }
  if (srcZone === "guest" && dstZone === "guest") {
    return {
      scope: "guest-L2-peer",
      visibleToFirewall: false,
      enforcementPoint: "wifi-driver",
      reason:
        "client-to-client frame relayed by the Wi-Fi driver (esp-idf #13781 closed not_planned); lwIP never sees it"
    };
  }
  if (srcZone === "guest" && (dstZone === "internet" || dstZone === "upstream")) {
    return {
      scope: "internet-routed",
      visibleToFirewall: true,
      enforcementPoint: "l3-firewall",
      reason: "forwarded guest→uplink through lwIP with NAPT"
    };
  }
  if ((srcZone === "internet" || srcZone === "upstream") && dstZone === "guest") {
    return {
      scope: "internet-routed",
      visibleToFirewall: true,
      enforcementPoint: "l3-firewall",
      reason: "forwarded uplink→guest through lwIP; requires an inbound DNAT mapping"
    };
  }
  return {
    scope: "lan-routed",
    visibleToFirewall: true,
    enforcementPoint: "l3-firewall",
    reason: "routed between logical LAN zones by the lwIP stack"
  };
}
