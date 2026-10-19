import { describe, expect, it } from "vitest";
import { buildSampleProject } from "../data/sampleLab";
import { checksumOf, parseProject, serializeProject, validateProject } from "./project";

describe("project file format", () => {
  it("round-trips a project through serialize → parse", () => {
    const project = buildSampleProject();
    const text = serializeProject(project, "2026-10-18T00:00:00.000Z");
    const result = parseProject(text);
    expect(result.ok).toBe(true);
    expect(result.project).toEqual(project);
    expect(result.errors).toEqual([]);
  });

  it("rejects files with a checksum mismatch", () => {
    const text = serializeProject(buildSampleProject());
    const tampered = text.replace('"name": "Home IoT guest lab"', '"name": "Tampered lab"');
    const result = parseProject(tampered);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("checksum"))).toBe(true);
  });

  it("supports checksum-skip recovery", () => {
    const text = serializeProject(buildSampleProject());
    const tampered = text.replace('"name": "Home IoT guest lab"', '"name": "Recovered lab"');
    const result = parseProject(tampered, { skipChecksum: true });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes("checksum"))).toBe(true);
    expect(result.project?.meta.name).toBe("Recovered lab");
  });

  it("rejects unknown schemas and newer versions without corrupting state", () => {
    expect(parseProject('{"schema":"something.else"}').ok).toBe(false);
    expect(parseProject("not json at all").ok).toBe(false);
    const project = buildSampleProject();
    const file = { schema: "warden32.project", schemaVersion: 99, project };
    const result = parseProject(JSON.stringify(file));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("newer"))).toBe(true);
  });

  it("validates addresses, references and pools", () => {
    const project = buildSampleProject();
    project.devices[6].ipv4 = "300.1.1.1";
    project.routes[0].interfaceId = "nope0";
    const guestIface = project.interfaces.find((i) => i.id === "guest0");
    if (guestIface?.dhcp) guestIface.dhcp.poolStart = "10.9.0.10";
    const validation = validateProject(project);
    expect(validation.errors.some((e) => e.includes("invalid IPv4"))).toBe(true);
    expect(validation.errors.some((e) => e.includes("unknown interface"))).toBe(true);
    expect(validation.errors.some((e) => e.includes("pool outside subnet"))).toBe(true);
  });

  it("detects duplicate device addresses as warnings", () => {
    const project = buildSampleProject();
    const plug = project.devices.find((d) => d.id === "plug");
    if (plug) plug.ipv4 = "10.0.0.11";
    const validation = validateProject(project);
    expect(validation.errors).toEqual([]);
    expect(validation.warnings.some((w) => w.includes("duplicate IPv4"))).toBe(true);
  });

  it("validates bandwidth fields", () => {
    const project = buildSampleProject();
    const cam = project.devices.find((d) => d.id === "cam")!;
    cam.demandMbps = -1;
    cam.capMbps = 0;
    project.sim.uplinkMbps = -5;
    const validation = validateProject(project);
    expect(validation.errors.some((e) => e.includes("demandMbps"))).toBe(true);
    expect(validation.errors.some((e) => e.includes("capMbps"))).toBe(true);
    expect(validation.errors.some((e) => e.includes("uplinkMbps"))).toBe(true);
  });

  it("accepts bandwidth fields being absent (older files)", () => {
    const project = buildSampleProject();
    delete project.sim.uplinkMbps;
    for (const device of project.devices) {
      delete device.demandMbps;
      delete device.capMbps;
    }
    expect(validateProject(project).errors).toEqual([]);
    const text = serializeProject(project);
    expect(parseProject(text).ok).toBe(true);
  });

  it("produces a stable checksum for identical content", () => {
    const a = checksumOf(buildSampleProject());
    const b = checksumOf(buildSampleProject());
    expect(a).toBe(b);
    const project = buildSampleProject();
    project.meta.name = "Other";
    expect(checksumOf(project)).not.toBe(a);
  });
});
