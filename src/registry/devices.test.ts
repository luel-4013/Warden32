import { describe, expect, it } from "vitest";
import { DEVICE_ARCHETYPES, archetypeById, iotArchetypes } from "./devices";
import { TRAFFIC_PROFILES } from "../engine/traffic";

describe("device archetype registry", () => {
  it("ships at least 15 IoT archetypes", () => {
    expect(iotArchetypes().length).toBeGreaterThanOrEqual(15);
  });

  it("has unique ids", () => {
    const ids = DEVICE_ARCHETYPES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(archetypeById("camera")?.name).toBe("IP camera");
    expect(archetypeById("nope")).toBeNull();
  });

  it("references only existing traffic profiles", () => {
    for (const archetype of DEVICE_ARCHETYPES) {
      if (archetype.trafficProfileId === "none") continue;
      expect(TRAFFIC_PROFILES[archetype.trafficProfileId], `${archetype.id} → ${archetype.trafficProfileId}`).toBeDefined();
    }
  });

  it("gives vendor-only archetypes at least one vendor endpoint", () => {
    for (const archetype of DEVICE_ARCHETYPES) {
      if (archetype.egressPolicyId === "vendor-only") {
        expect(archetype.vendorEndpoints.length, archetype.id).toBeGreaterThan(0);
      }
    }
  });

  it("declares valid ports and tags provenance", () => {
    for (const archetype of DEVICE_ARCHETYPES) {
      for (const service of archetype.services) {
        expect(service.port).toBeGreaterThan(0);
        expect(service.port).toBeLessThanOrEqual(65535);
      }
      expect(["measured", "datasheet", "paper", "estimate", "assumption"]).toContain(archetype.provenance);
      expect(archetype.notes.length).toBeGreaterThan(0);
    }
  });
});
