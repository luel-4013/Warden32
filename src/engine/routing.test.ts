import { describe, expect, it } from "vitest";
import { buildConnectedRoutes, lookupRoute } from "./routing";
import type { InterfaceModel, RouteModel } from "./model";

const wan: InterfaceModel = {
  id: "wan0",
  name: "WAN",
  zone: "upstream",
  kind: "ethernet",
  mac: "00:00:00:00:00:01",
  ipv4: "192.168.1.23",
  prefix: 24,
  up: true,
  dhcp: null
};

const guest: InterfaceModel = {
  id: "guest0",
  name: "Guest",
  zone: "guest",
  kind: "wifi-ap",
  mac: "00:00:00:00:00:02",
  ipv4: "10.0.0.1",
  prefix: 24,
  up: true,
  dhcp: null
};

const down: InterfaceModel = { ...guest, id: "trusted0", ipv4: "10.2.0.1", up: false };

const defaultRoute: RouteModel = {
  id: "default",
  dst: "0.0.0.0/0",
  via: "192.168.1.1",
  interfaceId: "wan0",
  kind: "default",
  enabled: true
};

describe("routing", () => {
  it("prefers the longest prefix (connected over default)", () => {
    const interfaces = [wan, guest, down];
    const routes = [...buildConnectedRoutes(interfaces), defaultRoute];
    const result = lookupRoute("10.0.0.11", routes, interfaces);
    expect(result.matched?.kind).toBe("connected");
    expect(result.matched?.interfaceId).toBe("guest0");
  });

  it("falls back to the default route for internet destinations", () => {
    const interfaces = [wan, guest, down];
    const routes = [...buildConnectedRoutes(interfaces), defaultRoute];
    const result = lookupRoute("203.0.113.65", routes, interfaces);
    expect(result.matched?.kind).toBe("default");
    expect(result.nextHop).toBe("192.168.1.1");
  });

  it("ignores routes on interfaces that are down and reports why", () => {
    const interfaces = [wan, guest, down];
    const routes = [...buildConnectedRoutes(interfaces)];
    const result = lookupRoute("10.2.0.50", routes, interfaces);
    expect(result.matched).toBeNull();
    expect(result.reason).toContain("no route");
    expect(result.candidates.some((c) => c.includes("down"))).toBe(true);
  });

  it("reports interface-down candidates when a static route exists", () => {
    const interfaces = [wan, guest, down];
    const staticRoute: RouteModel = {
      id: "s1",
      dst: "10.2.0.0/24",
      via: null,
      interfaceId: "trusted0",
      kind: "static",
      enabled: true
    };
    const routes = [...buildConnectedRoutes(interfaces), defaultRoute, staticRoute];
    const result = lookupRoute("10.2.0.50", routes, interfaces);
    expect(result.matched?.kind).toBe("default");
    expect(result.candidates.some((c) => c.includes("down"))).toBe(true);
  });

  it("returns no match for unreachable networks with an empty table", () => {
    const result = lookupRoute("10.9.9.9", [], [wan, guest]);
    expect(result.matched).toBeNull();
    expect(result.reason).toContain("routing table is empty");
  });

  it("disabling a route removes it from candidates", () => {
    const interfaces = [wan, guest];
    const disabled: RouteModel = { ...defaultRoute, enabled: false };
    const result = lookupRoute("203.0.113.65", [disabled], interfaces);
    expect(result.matched).toBeNull();
    expect(result.candidates.some((c) => c.includes("disabled"))).toBe(true);
  });
});
