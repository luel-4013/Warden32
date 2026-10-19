import { cidrOf, inSubnet, prefixLengthOf } from "./address";
import type { InterfaceModel, RouteModel } from "./model";

export interface RouteLookup {
  matched: RouteModel | null;
  prefixLen: number;
  reason: string;
  nextHop: string | null;
  egressInterfaceId: string | null;
  candidates: string[];
}

export function connectedRouteFor(iface: InterfaceModel): RouteModel | null {
  if (!iface.ipv4) return null;
  return {
    id: `connected:${iface.id}`,
    dst: cidrOf(iface.ipv4, iface.prefix),
    via: null,
    interfaceId: iface.id,
    kind: "connected",
    enabled: true
  };
}

export function buildConnectedRoutes(interfaces: InterfaceModel[]): RouteModel[] {
  const routes: RouteModel[] = [];
  for (const iface of interfaces) {
    const route = connectedRouteFor(iface);
    if (route) routes.push(route);
  }
  return routes;
}

export function isLocalAddress(dstIp: string, interfaces: InterfaceModel[]): InterfaceModel | null {
  for (const iface of interfaces) {
    if (iface.ipv4 && iface.ipv4 === dstIp) return iface;
  }
  return null;
}

export function lookupRoute(
  dstIp: string,
  routes: RouteModel[],
  interfaces: InterfaceModel[]
): RouteLookup {
  const candidates: string[] = [];
  let best: RouteModel | null = null;
  let bestPrefix = -1;

  for (const route of routes) {
    if (!route.enabled) {
      candidates.push(`${route.dst} (disabled)`);
      continue;
    }
    const iface = interfaces.find((i) => i.id === route.interfaceId);
    if (!iface) {
      candidates.push(`${route.dst} (missing interface ${route.interfaceId})`);
      continue;
    }
    if (!iface.up) {
      candidates.push(`${route.dst} (interface ${iface.id} down)`);
      continue;
    }
    if (!inSubnet(dstIp, route.dst)) continue;
    const prefixLen = prefixLengthOf(route.dst);
    candidates.push(route.dst);
    if (prefixLen > bestPrefix) {
      best = route;
      bestPrefix = prefixLen;
    }
  }

  if (!best) {
    return {
      matched: null,
      prefixLen: -1,
      reason: candidates.length > 0 ? "no route matches destination" : "routing table is empty",
      nextHop: null,
      egressInterfaceId: null,
      candidates
    };
  }

  const egress = interfaces.find((i) => i.id === best?.interfaceId) ?? null;
  const nextHop = best.via ?? (egress && egress.ipv4 ? best.dst.split("/")[0] : null);
  const kindLabel = best.kind === "default" ? "default" : best.kind;
  const reason =
    best.kind === "connected"
      ? `connected route ${best.dst} dev ${best.interfaceId}`
      : `${kindLabel} route ${best.dst}${best.via ? ` via ${best.via}` : ""} dev ${best.interfaceId}`;

  return {
    matched: best,
    prefixLen: bestPrefix,
    reason,
    nextHop,
    egressInterfaceId: best.interfaceId,
    candidates
  };
}
