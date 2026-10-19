import { inSubnet, parseIPv4 } from "../engine/address";
import type { ProjectModel } from "../engine/model";
import { ETHERNET_ADAPTERS, FIRMWARE_PROFILES, HARDWARE_PROFILES } from "../registry/profiles";

export const PROJECT_SCHEMA = "warden32.project";
export const PROJECT_SCHEMA_VERSION = 1;
export const ENGINE_VERSION = "0.3.0";

export interface ProjectFile {
  schema: string;
  schemaVersion: number;
  engineVersion: string;
  checksum: string;
  exportedAt: string;
  project: ProjectModel;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function checksumOf(project: ProjectModel): string {
  const text = canonicalJson(project);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}`;
}

export function serializeProject(project: ProjectModel, exportedAt?: string): string {
  const file: ProjectFile = {
    schema: PROJECT_SCHEMA,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    checksum: checksumOf(project),
    exportedAt: exportedAt ?? new Date().toISOString(),
    project
  };
  return JSON.stringify(file, null, 2);
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function tryIp(ip: string): boolean {
  try {
    parseIPv4(ip);
    return true;
  } catch {
    return false;
  }
}

function tryCidr(cidr: string): boolean {
  try {
    inSubnet("0.0.0.0", cidr);
    return true;
  } catch {
    return false;
  }
}

export function validateProject(project: ProjectModel): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    errors.push(`unsupported schema version ${project.schemaVersion}`);
  }
  if (!project.meta || !isString(project.meta.id) || project.meta.id === "") errors.push("meta.id missing");
  if (!project.meta || !isString(project.meta.name) || project.meta.name === "") errors.push("meta.name missing");

  const sim = project.sim;
  if (!sim || !isNumber(sim.seed)) errors.push("sim.seed missing or not a number");
  if (!isString(sim.boardId)) errors.push("sim.boardId missing");
  else if (HARDWARE_PROFILES.every((board) => board.id !== sim.boardId)) errors.push(`sim.boardId unknown: ${sim.boardId}`);
  if (!isString(sim.adapterId)) errors.push("sim.adapterId missing");
  else if (ETHERNET_ADAPTERS.every((adapter) => adapter.id !== sim.adapterId)) errors.push(`sim.adapterId unknown: ${sim.adapterId}`);
  if (!isString(sim.firmwareId)) errors.push("sim.firmwareId missing");
  else if (!FIRMWARE_PROFILES[sim.firmwareId]) errors.push(`sim.firmwareId unknown: ${sim.firmwareId}`);
  if (!isString(sim.publicIp) || !tryIp(sim.publicIp)) errors.push("sim.publicIp invalid");
  else if (!inSubnet(sim.publicIp, "203.0.113.0/24") && !inSubnet(sim.publicIp, "198.51.100.0/24") && !inSubnet(sim.publicIp, "192.0.2.0/24")) {
    warnings.push("sim.publicIp is outside the RFC 5737 documentation ranges (simulation-assigned addresses are recommended)");
  }
  if (!isString(sim.dnsUpstream) || !tryIp(sim.dnsUpstream)) errors.push("sim.dnsUpstream invalid");
  if (sim.uplinkMbps !== undefined && (!isNumber(sim.uplinkMbps) || sim.uplinkMbps <= 0 || sim.uplinkMbps > 100000)) {
    errors.push("sim.uplinkMbps must be a positive number of Mbps (max 100000)");
  }

  const zoneIds = new Set(project.zones.map((z) => z.id));
  if (zoneIds.size !== project.zones.length) errors.push("duplicate zone ids");

  const ifaceIds = new Set<string>();
  for (const iface of project.interfaces) {
    if (ifaceIds.has(iface.id)) errors.push(`duplicate interface id ${iface.id}`);
    ifaceIds.add(iface.id);
    if (!zoneIds.has(iface.zone)) errors.push(`interface ${iface.id} references unknown zone ${iface.zone}`);
    if (iface.ipv4 !== null && !tryIp(iface.ipv4)) errors.push(`interface ${iface.id} has invalid IPv4 ${iface.ipv4}`);
    if (!Number.isInteger(iface.prefix) || iface.prefix < 0 || iface.prefix > 32) {
      errors.push(`interface ${iface.id} has invalid prefix ${iface.prefix}`);
    }
    if (iface.dhcp && iface.dhcp.enabled) {
      if (!tryIp(iface.dhcp.poolStart) || !tryIp(iface.dhcp.poolEnd)) {
        errors.push(`interface ${iface.id} DHCP pool addresses invalid`);
      } else if (iface.ipv4) {
        const network = `${iface.ipv4}/${iface.prefix}`;
        if (!inSubnet(iface.dhcp.poolStart, network) || !inSubnet(iface.dhcp.poolEnd, network)) {
          errors.push(`interface ${iface.id} DHCP pool outside subnet ${network}`);
        }
        const start = parseIPv4(iface.dhcp.poolStart);
        const end = parseIPv4(iface.dhcp.poolEnd);
        if (start > end) errors.push(`interface ${iface.id} DHCP pool start after end`);
      }
    }
  }

  const deviceIds = new Set<string>();
  const deviceIps = new Map<string, string>();
  for (const dev of project.devices) {
    if (deviceIds.has(dev.id)) errors.push(`duplicate device id ${dev.id}`);
    deviceIds.add(dev.id);
    if (!zoneIds.has(dev.zone)) errors.push(`device ${dev.id} references unknown zone ${dev.zone}`);
    if (dev.interfaceId !== null && !ifaceIds.has(dev.interfaceId)) {
      errors.push(`device ${dev.id} references unknown interface ${dev.interfaceId}`);
    }
    const ips = [dev.ipv4, ...dev.extraIps].filter((ip): ip is string => ip !== null);
    for (const ip of ips) {
      if (!tryIp(ip)) {
        errors.push(`device ${dev.id} has invalid IPv4 ${ip}`);
        continue;
      }
      const owner = deviceIps.get(ip);
      if (owner) warnings.push(`duplicate IPv4 ${ip} on ${owner} and ${dev.id}`);
      else deviceIps.set(ip, dev.id);
    }
    if (!["vendor-only", "allow-all", "block-all"].includes(dev.egressPolicyId)) {
      errors.push(`device ${dev.id} has invalid egress policy ${dev.egressPolicyId}`);
    }
    if (!["normal", "noisy", "misconfigured"].includes(dev.behaviorState)) {
      errors.push(`device ${dev.id} has invalid behavior state ${dev.behaviorState}`);
    }
    if (dev.demandMbps !== undefined && dev.demandMbps !== null && (!isNumber(dev.demandMbps) || dev.demandMbps < 0)) {
      errors.push(`device ${dev.id} has invalid demandMbps (must be >= 0 Mbps)`);
    }
    if (dev.capMbps !== undefined && dev.capMbps !== null && (!isNumber(dev.capMbps) || dev.capMbps <= 0)) {
      errors.push(`device ${dev.id} has invalid capMbps (must be > 0 Mbps)`);
    }
  }

  for (const route of project.routes) {
    if (!ifaceIds.has(route.interfaceId)) errors.push(`route ${route.id} references unknown interface ${route.interfaceId}`);
    if (!tryCidr(route.dst)) errors.push(`route ${route.id} has invalid destination ${route.dst}`);
    if (route.via !== null && !tryIp(route.via)) errors.push(`route ${route.id} has invalid next hop ${route.via}`);
    if (route.kind === "default" && route.dst !== "0.0.0.0/0") {
      warnings.push(`route ${route.id} is marked default but destination is ${route.dst}`);
    }
  }

  const ruleIds = new Set<string>();
  for (const rule of project.firewall.rules) {
    if (ruleIds.has(rule.id)) errors.push(`duplicate rule id ${rule.id}`);
    ruleIds.add(rule.id);
    for (const range of [rule.srcPorts, rule.dstPorts]) {
      if (range && (range[0] < 0 || range[1] > 65535 || range[0] > range[1])) {
        errors.push(`rule ${rule.id} has invalid port range`);
      }
    }
    if (rule.inInterface !== "any" && !ifaceIds.has(rule.inInterface)) {
      errors.push(`rule ${rule.id} references unknown in-interface ${rule.inInterface}`);
    }
    if (rule.outInterface !== "any" && !ifaceIds.has(rule.outInterface)) {
      errors.push(`rule ${rule.id} references unknown out-interface ${rule.outInterface}`);
    }
  }

  for (const forward of project.portForwards) {
    const router = project.devices.find((d) => d.id === forward.routerId);
    if (!router || (!router.isRouter && !router.gateway)) {
      errors.push(`port-forward ${forward.id} references unknown router ${forward.routerId}`);
    }
    if (!deviceIds.has(forward.internalDeviceId)) {
      errors.push(`port-forward ${forward.id} references unknown device ${forward.internalDeviceId}`);
    }
    for (const port of [forward.externalPort, forward.internalPort]) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push(`port-forward ${forward.id} has invalid port ${port}`);
      }
    }
  }

  const resources = project.resources;
  for (const [key, value] of Object.entries(resources)) {
    if (value === null) continue;
    if (!isNumber(value) || value <= 0) errors.push(`resources.${key} must be a positive number`);
  }

  return { errors, warnings };
}

export interface ParseResult {
  ok: boolean;
  project: ProjectModel | null;
  errors: string[];
  warnings: string[];
}

export function parseProject(text: string, options?: { skipChecksum?: boolean }): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, project: null, errors: [`not valid JSON: ${(error as Error).message}`], warnings: [] };
  }
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, project: null, errors: ["file is not a Warden32 project object"], warnings: [] };
  }
  const file = raw as Partial<ProjectFile>;
  if (file.schema !== PROJECT_SCHEMA) {
    return { ok: false, project: null, errors: [`unknown schema "${String(file.schema)}" (expected ${PROJECT_SCHEMA})`], warnings: [] };
  }
  if (!isNumber(file.schemaVersion) || file.schemaVersion > PROJECT_SCHEMA_VERSION) {
    return {
      ok: false,
      project: null,
      errors: [`schema version ${String(file.schemaVersion)} is newer than this build supports (${PROJECT_SCHEMA_VERSION})`],
      warnings: []
    };
  }
  if (!file.project || typeof file.project !== "object") {
    return { ok: false, project: null, errors: ["project payload missing"], warnings: [] };
  }
  const project = file.project as ProjectModel;
  const warnings: string[] = [];
  if (!options?.skipChecksum && isString(file.checksum)) {
    const actual = checksumOf(project);
    if (actual !== file.checksum) {
      return {
        ok: false,
        project: null,
        errors: [`checksum mismatch (file ${file.checksum}, computed ${actual}) — file may be corrupted`],
        warnings
      };
    }
  } else if (isString(file.checksum) && options?.skipChecksum) {
    warnings.push("checksum verification skipped");
  }
  const validation = validateProject(project);
  warnings.push(...validation.warnings);
  if (validation.errors.length > 0) {
    return { ok: false, project: null, errors: validation.errors, warnings };
  }
  return { ok: true, project, errors: [], warnings };
}
