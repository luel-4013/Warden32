import { describe, expect, it } from "vitest";
import { IncidentLog } from "./incident";
import { SimEngine } from "./engine";
import { buildSampleProject } from "../data/sampleLab";
import { buildSampleFlows } from "../data/sampleLab";
import type { FirmwareProfileId } from "../registry/profiles";

function makeEngine(firmwareId: FirmwareProfileId): SimEngine {
  const project = buildSampleProject();
  project.sim.firmwareId = firmwareId;
  if (firmwareId === "target-v1") {
    project.firewall.dialect = "stateful";
    project.firewall.defaultPolicy = "deny";
  }
  return new SimEngine(project);
}

function sampleFlow(id: string) {
  const flow = buildSampleFlows().find((f) => f.id === id);
  if (!flow) throw new Error(`missing ${id}`);
  return flow;
}

describe("incident log", () => {
  it("tracks the open → contained → closed lifecycle with actions", () => {
    const log = new IncidentLog();
    const incident = log.open({ title: "C2 beaconing", deviceId: "cam", severity: "high", evidence: [4, 5], atMs: 1000 });
    expect(incident.id).toBe("INC-001");
    expect(log.openCount).toBe(1);

    log.contain(incident.id, 2000, "camera quarantined");
    expect(log.all[0].status).toBe("contained");
    expect(log.all[0].actions[0].kind).toBe("quarantine");

    log.addEvidence(incident.id, [9]);
    expect(log.all[0].evidence).toEqual([4, 5, 9]);

    log.close(incident.id, 3000, "device cleaned, released");
    expect(log.all[0].status).toBe("closed");
    expect(log.all[0].closedMs).toBe(3000);
    expect(log.openCount).toBe(0);
  });

  it("refuses further actions on closed incidents", () => {
    const log = new IncidentLog();
    const incident = log.open({ title: "x", severity: "low", atMs: 0 });
    log.close(incident.id, 10, "done");
    expect(log.contain(incident.id, 20, "late")).toBeNull();
    expect(log.addEvidence(incident.id, [1])).toBeNull();
  });
});

describe("quarantine response", () => {
  it("drops all flows from a quarantined device with honest labels", () => {
    const engine = makeEngine("stock-eth");
    engine.setQuarantine("cam", true);
    const result = engine.submitFlow(sampleFlow("f1"));
    expect(result.verdict).toBe("dropped");
    expect(result.matchedRule).toBe("incident:quarantine");
    expect(result.reason).toContain("quarantined");
    expect(result.labels).toContain("incident response: device quarantined");
    expect(result.labels.some((l) => l.includes("cannot isolate a client"))).toBe(true);
  });

  it("also drops traffic destined to a quarantined device", () => {
    const engine = makeEngine("stock-eth");
    engine.setQuarantine("cam", true);
    const result = engine.submitFlow(sampleFlow("f4"));
    expect(result.verdict).toBe("dropped");
    expect(result.matchedRule).toBe("incident:quarantine");
  });

  it("lets traffic flow again after release", () => {
    const engine = makeEngine("stock-eth");
    engine.setQuarantine("cam", true);
    engine.setQuarantine("cam", false);
    expect(engine.submitFlow(sampleFlow("f1")).verdict).toBe("allowed");
  });

  it("records containment in the incident log", () => {
    const engine = makeEngine("stock-eth");
    const incident = engine.incidents.open({
      title: "Suspected compromise",
      deviceId: "cam",
      severity: "high",
      atMs: 0
    });
    engine.setQuarantine("cam", true, incident.id);
    expect(engine.incidents.all[0].status).toBe("contained");
    expect(engine.incidents.all[0].actions[0].detail).toContain("cam");
  });
});

describe("block rule response", () => {
  it("inserts a top-priority drop rule under the stateful dialect", () => {
    const engine = makeEngine("target-v1");
    const response = engine.addBlockRule("cam");
    expect(response.ok).toBe(true);
    expect(response.ruleId).toBe("incident-block-cam");

    const result = engine.submitFlow(sampleFlow("f1"));
    expect(result.verdict).toBe("denied");
    expect(result.matchedRule).toBe("incident-block-cam");
  });

  it("explains why the stock ACL cannot block a guest source", () => {
    const engine = makeEngine("stock-eth");
    const response = engine.addBlockRule("cam");
    expect(response.ok).toBe(false);
    expect(response.message).toContain("cannot block a guest host");
  });
});
