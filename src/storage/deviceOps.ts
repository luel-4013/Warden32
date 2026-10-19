import { ipv4ToString, parseIPv4, prefixLengthOf } from "../engine/address";
import type { DeviceModel, ProjectModel, ZoneId } from "../engine/model";
import { activityBehaviorFor } from "../registry/activity";
import { archetypeById } from "../registry/devices";

export interface NewDeviceInput {
  name: string;
  archetypeId: string;
  zone: ZoneId;
  demandMbps: number | null;
  capMbps: number | null;
}

export interface DeviceOpResult {
  ok: boolean;
  error?: string;
  deviceId?: string;
}

const MANAGED_ZONES: ZoneId[] = ["guest", "trusted", "mgmt"];
const MAC_PREFIX = "3c:71:bf";

function slugifyName(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "device" : slug;
}

export function makeDeviceId(name: string, existing: Set<string>): string {
  const base = slugifyName(name);
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export function nextFreeIpv4(project: ProjectModel, zoneId: ZoneId): string | null {
  const zone = project.zones.find((item) => item.id === zoneId);
  if (!zone || !zone.cidr) return null;
  const [base, prefixText] = zone.cidr.split("/");
  const prefix = prefixLengthOf(zone.cidr);
  void prefixText;
  const size = 2 ** (32 - prefix);
  if (size <= 4) return null;
  const network = parseIPv4(base) & ((size - 1) ^ 0xffffffff);
  const taken = new Set<number>();
  for (const iface of project.interfaces) {
    if (iface.ipv4) taken.add(parseIPv4(iface.ipv4));
    if (iface.dhcp && iface.dhcp.enabled) {
      const start = parseIPv4(iface.dhcp.poolStart);
      const end = parseIPv4(iface.dhcp.poolEnd);
      for (let n = start; n <= end && n - start <= 4096; n += 1) taken.add(n >>> 0);
    }
  }
  for (const device of project.devices) {
    if (device.ipv4) taken.add(parseIPv4(device.ipv4));
    for (const ip of device.extraIps) taken.add(parseIPv4(ip));
  }
  for (let host = 2; host < size - 1; host += 1) {
    const candidate = (network + host) >>> 0;
    if (!taken.has(candidate)) return ipv4ToString(candidate);
  }
  return null;
}

export function nextMac(project: ProjectModel): string {
  const taken = new Set(project.devices.map((device) => device.mac.toLowerCase()));
  for (let b = 0x00; b <= 0xfe; b += 1) {
    for (let c = 0x10; c <= 0xff; c += 1) {
      const mac = `${MAC_PREFIX}:00:${b.toString(16).padStart(2, "0")}:${c.toString(16).padStart(2, "0")}`;
      if (!taken.has(mac)) return mac;
    }
  }
  throw new Error("MAC address space exhausted in the hardware-testing block");
}

export function defaultDemandFor(archetypeId: string): number | null {
  const archetype = archetypeById(archetypeId);
  if (!archetype) return null;
  return activityBehaviorFor(archetype.trafficProfileId).demandMbps;
}

export function addDeviceToProject(draft: ProjectModel, input: NewDeviceInput): DeviceOpResult {
  const name = input.name.trim();
  if (name === "") return { ok: false, error: "device name is required" };
  if (!MANAGED_ZONES.includes(input.zone)) {
    return { ok: false, error: `zone must be one of ${MANAGED_ZONES.join(", ")}` };
  }
  const archetype = archetypeById(input.archetypeId);
  if (!archetype || archetype.category !== "iot") {
    return { ok: false, error: `unknown IoT archetype: ${input.archetypeId}` };
  }
  if (input.demandMbps !== null && (!Number.isFinite(input.demandMbps) || input.demandMbps < 0)) {
    return { ok: false, error: "demand must be a non-negative number of Mbps" };
  }
  if (input.capMbps !== null && (!Number.isFinite(input.capMbps) || input.capMbps <= 0)) {
    return { ok: false, error: "cap must be a positive number of Mbps (or empty)" };
  }
  const ipv4 = nextFreeIpv4(draft, input.zone);
  if (!ipv4) return { ok: false, error: `no free IPv4 address in zone ${input.zone} (missing CIDR or exhausted)` };

  const ids = new Set(draft.devices.map((device) => device.id));
  const id = makeDeviceId(name, ids);
  const iface = draft.interfaces.find((item) => item.zone === input.zone) ?? null;
  const device: DeviceModel = {
    id,
    name,
    role: "iot",
    zone: input.zone,
    mac: nextMac(draft),
    ipv4,
    interfaceId: iface ? iface.id : null,
    online: true,
    compromised: false,
    behaviorState: "normal",
    quarantined: false,
    isRouter: false,
    gateway: false,
    extraIps: [],
    services: archetype.services.map((service) => ({ ...service })),
    trafficProfileId: archetype.trafficProfileId,
    vendorEndpoints: archetype.vendorEndpoints.map((endpoint) => ({ ...endpoint })),
    egressPolicyId: archetype.egressPolicyId,
    managementPorts: [...archetype.managementPorts],
    notes: `Added via the lab editor — ${archetype.name}.`,
    provenance: "assumption",
    demandMbps: input.demandMbps,
    capMbps: input.capMbps
  };
  draft.devices.push(device);
  return { ok: true, deviceId: id };
}

export function removeDeviceFromProject(draft: ProjectModel, deviceId: string): DeviceOpResult {
  const device = draft.devices.find((item) => item.id === deviceId);
  if (!device) return { ok: false, error: `unknown device: ${deviceId}` };
  if (device.isRouter || device.gateway) return { ok: false, error: `${device.name} is infrastructure (router/gateway) and cannot be removed` };
  if (device.zone === "internet") return { ok: false, error: `${device.name} is an external host and cannot be removed` };
  draft.devices = draft.devices.filter((item) => item.id !== deviceId);
  draft.portForwards = draft.portForwards.filter(
    (forward) => forward.internalDeviceId !== deviceId && forward.routerId !== deviceId
  );
  draft.firewall.rules = draft.firewall.rules.filter((rule) => rule.src !== deviceId);
  return { ok: true, deviceId };
}

export function isRemovableDevice(device: Pick<DeviceModel, "isRouter" | "gateway" | "zone">): boolean {
  return !device.isRouter && !device.gateway && device.zone !== "internet";
}
