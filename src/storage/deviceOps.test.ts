import { describe, expect, it } from "vitest";
import { buildSampleProject } from "../data/sampleLab";
import type { ProjectModel } from "../engine/model";
import { addDeviceToProject, defaultDemandFor, isRemovableDevice, makeDeviceId, nextFreeIpv4, nextMac, removeDeviceFromProject } from "./deviceOps";

function project(): ProjectModel {
  return buildSampleProject();
}

describe("device operations", () => {
  it("allocates the next free address, skipping taken, interface and DHCP-pool addresses", () => {
    const p = project();
    const ip = nextFreeIpv4(p, "guest");
    expect(ip).toBe("10.0.0.2");
    p.devices.push({ ...p.devices.find((d) => d.id === "cam")!, id: "extra", ipv4: "10.0.0.2" });
    expect(nextFreeIpv4(p, "guest")).toBe("10.0.0.3");
    for (let host = 3; host <= 19; host += 1) {
      p.devices.push({ ...p.devices.find((d) => d.id === "cam")!, id: `x${host}`, ipv4: `10.0.0.${host}` });
    }
    expect(nextFreeIpv4(p, "guest")).toBe("10.0.0.20");
    for (let host = 20; host <= 99; host += 1) {
      p.devices.push({ ...p.devices.find((d) => d.id === "cam")!, id: `y${host}`, ipv4: `10.0.0.${host}` });
    }
    expect(nextFreeIpv4(p, "guest")).toBe("10.0.0.150");
  });

  it("returns null when the zone has no CIDR", () => {
    const p = project();
    expect(nextFreeIpv4(p, "internet")).toBeNull();
  });

  it("generates unique MACs in the hardware-testing block", () => {
    const p = project();
    const mac = nextMac(p);
    expect(mac).toMatch(/^3c:71:bf:00:[0-9a-f]{2}:[0-9a-f]{2}$/);
    expect(p.devices.every((device) => device.mac.toLowerCase() !== mac)).toBe(true);
  });

  it("creates unique ids", () => {
    const existing = new Set(["camera", "camera-2"]);
    expect(makeDeviceId("Camera", existing)).toBe("camera-3");
    expect(makeDeviceId("My Sensor!", new Set())).toBe("my-sensor");
  });

  it("adds a device with archetype services and the zone interface", () => {
    const p = project();
    const result = addDeviceToProject(p, {
      name: "Hallway camera",
      archetypeId: "camera",
      zone: "guest",
      demandMbps: 1.2,
      capMbps: null
    });
    expect(result.ok).toBe(true);
    const device = p.devices.find((item) => item.id === result.deviceId);
    expect(device).toBeDefined();
    expect(device!.ipv4).toBe("10.0.0.2");
    expect(device!.interfaceId).toBe("guest0");
    expect(device!.trafficProfileId).toBe("stream-camera");
    expect(device!.demandMbps).toBe(1.2);
    expect(device!.services.length).toBeGreaterThan(0);
    expect(device!.role).toBe("iot");
  });

  it("rejects invalid input", () => {
    const p = project();
    expect(addDeviceToProject(p, { name: "  ", archetypeId: "camera", zone: "guest", demandMbps: null, capMbps: null }).ok).toBe(false);
    expect(addDeviceToProject(p, { name: "x", archetypeId: "nope", zone: "guest", demandMbps: null, capMbps: null }).ok).toBe(false);
    expect(addDeviceToProject(p, { name: "x", archetypeId: "camera", zone: "internet", demandMbps: null, capMbps: null }).ok).toBe(false);
    expect(addDeviceToProject(p, { name: "x", archetypeId: "camera", zone: "guest", demandMbps: -1, capMbps: null }).ok).toBe(false);
    expect(addDeviceToProject(p, { name: "x", archetypeId: "camera", zone: "guest", demandMbps: null, capMbps: 0 }).ok).toBe(false);
  });

  it("exposes archetype default demand", () => {
    expect(defaultDemandFor("camera")).toBe(2);
    expect(defaultDemandFor("sensor")).toBe(0.01);
    expect(defaultDemandFor("nope")).toBeNull();
  });

  it("removes a device along with its port-forwards and block rules", () => {
    const p = project();
    p.portForwards[1].enabled = true;
    p.portForwards[1].internalDeviceId = "cam";
    p.firewall.rules.push({
      id: "incident-block-cam",
      name: "block cam",
      enabled: true,
      src: "cam",
      dst: "any",
      srcZone: "any",
      dstZone: "any",
      protocol: "any",
      srcPorts: null,
      dstPorts: null,
      inInterface: "any",
      outInterface: "any",
      connStates: null,
      action: "drop",
      log: true,
      rateLimitPerSec: null,
      description: ""
    });
    const result = removeDeviceFromProject(p, "cam");
    expect(result.ok).toBe(true);
    expect(p.devices.some((device) => device.id === "cam")).toBe(false);
    expect(p.portForwards.some((forward) => forward.internalDeviceId === "cam")).toBe(false);
    expect(p.firewall.rules.some((rule) => rule.src === "cam")).toBe(false);
  });

  it("protects infrastructure and external hosts from removal", () => {
    const p = project();
    expect(removeDeviceFromProject(p, "esp32").ok).toBe(false);
    expect(removeDeviceFromProject(p, "home-router").ok).toBe(false);
    expect(removeDeviceFromProject(p, "vendor-cloud").ok).toBe(false);
    const esp32 = p.devices.find((device) => device.id === "esp32")!;
    const cam = p.devices.find((device) => device.id === "cam")!;
    expect(isRemovableDevice(esp32)).toBe(false);
    expect(isRemovableDevice(cam)).toBe(true);
  });
});
