import { connectedRouteFor, lookupRoute, type RouteLookup } from "./routing";
import { SimClock } from "./clock";
import { EventLog } from "./events";
import { evaluateFirewall, evaluateStockAclList, type RuleDecision, type RuleEvalContext } from "./firewall";
import { ConnTrackTable } from "./conntrack";
import { IncidentLog } from "./incident";
import { ResourceTracker, type ResourceSnapshot } from "./resources";
import { DEFAULT_CALIBRATION, resolveCalibration, type CalibrationProfile } from "./calibration";
import { NaptTable, NatTableFullError, type NaptMapping } from "./nat";
import { evaluateDeviceEgress } from "./policy";
import { classifyFlow, type Classification } from "./visibility";
import {
  ETHERNET_ADAPTERS,
  FIRMWARE_PROFILES,
  HARDWARE_PROFILES,
  type EthernetAdapter,
  type FirmwareProfile,
  type HardwareProfile
} from "../registry/profiles";
import type { DeviceModel, InterfaceModel, PortForwardModel, ProjectModel, RouteModel } from "./model";
import type {
  ConnState,
  EventCategory,
  EventSeverity,
  Flow,
  FlowResult,
  NatHop,
  Provenance,
  SimEvent
} from "./types";

const RATE_WINDOW_MS = 1000;

export interface EngineCounters {
  flows: number;
  allowed: number;
  denied: number;
  dropped: number;
  notEnforceable: number;
}

type EmitFn = (
  category: EventCategory,
  severity: EventSeverity,
  message: string,
  provenance: Provenance,
  extra?: Partial<SimEvent>
) => SimEvent;

export class SimEngine {
  readonly project: ProjectModel;
  readonly firmware: FirmwareProfile;
  readonly board: HardwareProfile;
  readonly adapter: EthernetAdapter;
  readonly events = new EventLog();
  readonly clock = new SimClock();
  readonly incidents = new IncidentLog();
  readonly counters: EngineCounters = { flows: 0, allowed: 0, denied: 0, dropped: 0, notEnforceable: 0 };
  readonly connections: ConnTrackTable;
  readonly resources: ResourceTracker;
  readonly calibration: CalibrationProfile;
  private readonly cal: ReturnType<typeof resolveCalibration>;
  private readonly guestNat: NaptTable;
  private readonly upstreamNat: NaptTable;
  private readonly ruleHits = new Map<string, number>();
  private readonly rateWindows = new Map<string, { windowStart: number; count: number }>();

  constructor(project: ProjectModel, calibration: CalibrationProfile = DEFAULT_CALIBRATION) {
    this.project = project;
    this.calibration = calibration;
    this.cal = resolveCalibration(calibration);
    this.firmware = FIRMWARE_PROFILES[project.sim.firmwareId];
    const board = HARDWARE_PROFILES.find((b) => b.id === project.sim.boardId);
    const adapter = ETHERNET_ADAPTERS.find((a) => a.id === project.sim.adapterId);
    if (!board) throw new Error(`unknown board: ${project.sim.boardId}`);
    if (!adapter) throw new Error(`unknown adapter: ${project.sim.adapterId}`);
    this.board = board;
    this.adapter = adapter;
    const router = this.routerDevice();
    this.connections = new ConnTrackTable(project.resources.conntrackCapacity);
    this.resources = new ResourceTracker(project, this.cal.ramBaseKb);
    this.guestNat = new NaptTable(router.name, this.wanIp(), project.resources.naptCapacity);
    this.upstreamNat = new NaptTable(this.gatewayDevice().name, project.sim.publicIp, project.resources.naptCapacity);
    this.emit("system", "info", `engine ready — ${this.firmware.name} · ${board.name} · ${adapter.name}`, "datasheet");
  }

  get now(): number {
    return this.clock.now;
  }

  get guestNapt(): NaptTable {
    return this.guestNat;
  }

  get upstreamNapt(): NaptTable {
    return this.upstreamNat;
  }

  ruleHitsFor(id: string): number {
    return this.ruleHits.get(id) ?? 0;
  }

  setQuarantine(deviceId: string, quarantined: boolean, incidentId?: string): DeviceModel {
    const device = this.device(deviceId);
    device.quarantined = quarantined;
    this.emit(
      "incident",
      quarantined ? "warn" : "info",
      `${device.name} ${quarantined ? "quarantined" : "released from quarantine"}`,
      "assumption",
      { deviceId }
    );
    if (incidentId) {
      const detail = quarantined
        ? `${device.name} quarantined — all its flows are dropped at the router`
        : `${device.name} released from quarantine`;
      if (quarantined) this.incidents.contain(incidentId, this.clock.now, detail);
      else this.incidents.addAction(incidentId, this.clock.now, "note", detail);
    }
    return device;
  }

  resourceSnapshot(): ResourceSnapshot {
    return this.resources.snapshot(this.clock.now, {
      ramKb: this.board.ramKb,
      conntrackUsed: this.connections.size,
      conntrackCapacity: this.connections.capacity,
      naptUsed: this.guestNat.size + this.upstreamNat.size
    });
  }

  setLinkState(interfaceId: string, up: boolean): InterfaceModel {
    const iface = this.project.interfaces.find((i) => i.id === interfaceId);
    if (!iface) throw new Error(`unknown interface: ${interfaceId}`);
    iface.up = up;
    this.emit("system", up ? "ok" : "warn", `interface ${iface.id} ${up ? "up" : "down"}`, "assumption");
    return iface;
  }

  setDeviceOnline(deviceId: string, online: boolean): DeviceModel {
    const device = this.device(deviceId);
    device.online = online;
    this.emit("system", online ? "ok" : "warn", `${device.name} ${online ? "online" : "offline"}`, "assumption", {
      deviceId
    });
    return device;
  }

  private txAdmission(
    flow: Flow,
    cls: Classification,
    cpuCost: number,
    airtimeCost: number,
    labels: string[],
    collected: SimEvent[]
  ): FlowResult | null {
    const { ok } = this.admitToResources(cpuCost, airtimeCost, labels);
    if (ok) return null;
    labels.push("tx queue full — buffer exhaustion (estimate)");
    this.counters.dropped += 1;
    collected.push(
      this.emit("resource", "warn", "tx queue overflow — buffer model drops the flow (estimate)", "estimate", {
        flowId: flow.id
      })
    );
    return this.finalize(
      flow,
      cls,
      "dropped",
      "tx queue full — buffer exhaustion during burst (estimate)",
      null,
      [],
      cpuCost,
      airtimeCost,
      labels,
      collected,
      "NEW",
      null
    );
  }

  private ramAllocationBlocked(
    flow: Flow,
    cls: Classification,
    labels: string[],
    collected: SimEvent[],
    chain: NatHop[],
    emit: EmitFn
  ): FlowResult | null {
    if (!this.resourceSnapshot().ramExhausted) return null;
    collected.push(emit("resource", "warn", "heap exhausted — connection state allocation failed (RAM model, estimate)", "estimate"));
    labels.push("RAM exhausted — allocation refused");
    this.counters.dropped += 1;
    return this.finalize(
      flow,
      cls,
      "dropped",
      "RAM model: heap exhausted — cannot allocate connection state",
      null,
      chain,
      this.routedCpu(),
      this.routedAirtime(),
      labels,
      collected,
      "NEW",
      null
    );
  }

  private admitToResources(cpuCost: number, airtimeCost: number, labels: string[]): { ok: boolean } {
    const { overflowed } = this.resources.enqueue(this.clock.now, cpuCost, airtimeCost);
    if (this.resources.cpuLoadPct(this.clock.now) > 100) {
      labels.push("CPU load estimate above 100% — real firmware would add latency, not drop (estimate)");
    }
    return { ok: !overflowed };
  }

  addBlockRule(deviceId: string): { ok: boolean; message: string; ruleId: string | null } {
    const device = this.device(deviceId);
    if (this.project.firewall.dialect !== "stateful") {
      return {
        ok: false,
        message:
          this.project.firewall.dialect === "stock-4list"
            ? "the stock 4-list ACL matches destination address/port, not the source device — it cannot block a guest host; remove or disable the client instead"
            : "no rule dialect is active — add a stateful baseline first",
        ruleId: null
      };
    }
    const ip = device.ipv4 ?? "any";
    const rule = {
      id: `incident-block-${device.id}`,
      name: `block ${device.name} (incident response)`,
      enabled: true,
      src: device.id,
      dst: "any",
      srcZone: "any" as const,
      dstZone: "any" as const,
      protocol: "any" as const,
      srcPorts: null,
      dstPorts: null,
      inInterface: "any",
      outInterface: "any",
      connStates: null,
      action: "drop" as const,
      log: true,
      rateLimitPerSec: null,
      description: `Inserted by incident response at ${this.clock.now} ms; source ${ip}.`
    };
    const existing = this.project.firewall.rules.findIndex((r) => r.id === rule.id);
    if (existing >= 0) this.project.firewall.rules.splice(existing, 1);
    this.project.firewall.rules.unshift(rule);
    this.emit("incident", "warn", `block rule inserted for ${device.name} (${ip})`, "assumption", { deviceId });
    return { ok: true, message: `rule ${rule.id} inserted at the top of the stateful rule list`, ruleId: rule.id };
  }

  advanceTo(ms: number): SimEvent[] {
    const before = this.events.lastId;
    this.clock.advanceTo(ms);
    this.resources.advance(ms);
    for (const entry of this.connections.expire(ms)) {
      this.emit(
        "conntrack",
        "info",
        `connection ${entry.id} expired (${entry.protocol} ${entry.srcIp} → ${entry.dstIp}, ${entry.packets} packet(s))`,
        "estimate"
      );
    }
    return this.events.since(before);
  }

  submitFlow(flow: Flow): FlowResult {
    const collected: SimEvent[] = [];
    const emit: EmitFn = (category, severity, message, provenance, extra) => {
      const event = this.emit(category, severity, message, provenance, { flowId: flow.id, ...extra });
      collected.push(event);
      return event;
    };

    const src = this.device(flow.srcDeviceId);
    const dst = this.device(flow.dstDeviceId);
    const labels: string[] = [];
    const cls = classifyFlow(src.zone, dst.zone, dst.isRouter, flow.protocol);
    emit("pipeline", "info", `${cls.scope} — ${cls.reason}`, "measured");
    if (!this.firmware.implementedOnHardware) labels.push("not implemented on hardware");
    this.counters.flows += 1;

    if (!src.online || !dst.online) {
      emit("pipeline", "warn", "device offline — no traffic generated", "assumption", {
        deviceId: src.online ? dst.id : src.id
      });
      this.counters.dropped += 1;
      return this.finalize(flow, cls, "dropped", "device offline", null, [], 0, 0, labels, collected, null, null);
    }

    if (src.quarantined || dst.quarantined) {
      const device = src.quarantined ? src : dst;
      labels.push("incident response: device quarantined");
      if (this.firmware.acl !== "stateful-default-deny") {
        labels.push("quarantine is a simulation response — stock firmware cannot isolate a client (no isolation feature)");
      } else if (!this.firmware.implementedOnHardware) {
        labels.push("quarantine is enforceable in the target design (not implemented on hardware)");
      }
      emit(
        "incident",
        "warn",
        `${device.name} is quarantined — flow dropped by incident response`,
        "assumption",
        { deviceId: device.id }
      );
      this.counters.dropped += 1;
      return this.finalize(
        flow,
        cls,
        "dropped",
        `device ${device.name} is quarantined (incident response)`,
        "incident:quarantine",
        [],
        this.routedCpu(),
        0,
        labels,
        collected,
        "INVALID",
        null
      );
    }

    if (!cls.visibleToFirewall) {
      labels.push("client isolation unavailable on ESP32 Wi-Fi");
      emit(
        "wifi",
        "warn",
        "frame relayed inside the Wi-Fi driver; lwIP never sees it — airtime consumed, zero CPU/NAT/ACL cost",
        "measured"
      );
      this.counters.notEnforceable += 1;
      return this.finalize(flow, cls, "not-enforceable", cls.reason, null, [], 0, this.cal.airtimeL2Relay, labels, collected, null, null);
    }

    if (flow.spoofedSrcIp && flow.spoofedSrcIp !== src.ipv4) {
      emit(
        "attack",
        "warn",
        `spoofed source ${flow.spoofedSrcIp} claimed by ${src.name} (${src.ipv4}) — rejected by ingress source check`,
        "assumption"
      );
      labels.push("spoofed source rejected at ingress");
      this.counters.dropped += 1;
      return this.finalize(
        flow,
        cls,
        "dropped",
        `ingress source check: ${src.name} claimed ${flow.spoofedSrcIp} but is ${src.ipv4} — spoofed packets are dropped`,
        "ingress:source-check",
        [],
        this.routedCpu(),
        0,
        labels,
        collected,
        "INVALID",
        null
      );
    }

    if (cls.scope === "esp32-local") {
      return this.evaluateEsp32Local(flow, src, cls, labels, emit);
    }

    if (src.zone === "internet" || src.zone === "upstream") {
      return this.evaluateInbound(flow, src, dst, cls, labels, emit);
    }

    return this.evaluateOutbound(flow, src, dst, cls, labels, emit);
  }

  private evaluateEsp32Local(
    flow: Flow,
    src: DeviceModel,
    cls: Classification,
    labels: string[],
    emit: EmitFn
  ): FlowResult {
    const nonIpv4 = flow.protocol === "ARP" || flow.protocol === "IPv6" || flow.protocol === "OTHER";
    const cpuCost = this.routedCpu();
    const collected: SimEvent[] = [];

    if (this.firmware.acl === "none") {
      collected.push(emit("firewall", "info", "baseline softap_sta + NAPT: no filtering of any kind", "datasheet"));
      const txDrop = this.txAdmission(flow, cls, cpuCost, this.routedAirtime(), labels, collected);
    if (txDrop) return txDrop;
    this.counters.allowed += 1;
      return this.finalize(flow, cls, "allowed", "minimal baseline profile — pure forward/NAT, no firewall configured", null, [], cpuCost, this.routedAirtime(), labels, collected, null, null);
    }

    if (nonIpv4) {
      const nonIpv4Note =
        this.project.firewall.dialect === "stateful"
          ? "stateful rules match IPv4 only — ARP/IPv6 frames pass unfiltered"
          : "stock ACLs match IPv4 only — ARP/IPv6 frames pass unfiltered";
      collected.push(emit("firewall", "warn", nonIpv4Note, "measured"));
      labels.push("non-IPv4 passes unfiltered");
      const txDrop = this.txAdmission(flow, cls, cpuCost, this.routedAirtime(), labels, collected);
    if (txDrop) return txDrop;
    this.counters.allowed += 1;
      return this.finalize(flow, cls, "allowed", `${cls.reason}; not matched by the stock IPv4 ACL — no rule can filter it`, null, [], cpuCost, this.routedAirtime(), labels, collected, null, null);
    }

    if (this.firmware.acl === "stateful-default-deny") {
      collected.push(emit("firewall", "warn", "target design v1 — stateful default-deny, management exposed on serial only", "assumption"));
      this.counters.denied += 1;
      return this.finalize(flow, cls, "denied", `target design v1 — stateful default-deny, management exposed on serial only (probe from ${src.name})`, "target:mgmt-serial-only", [], cpuCost, this.routedAirtime(), labels, collected, "NEW", null);
    }

    labels.push(`management surface reachable (${this.firmware.managementChannels.join(", ")})`);
    collected.push(emit("firewall", "warn", "esp32-local delivery is not matched by the stock 4 forwarded-traffic ACL lists", "measured"));
    const txDrop = this.txAdmission(flow, cls, cpuCost, this.routedAirtime(), labels, collected);
    if (txDrop) return txDrop;
    this.counters.allowed += 1;
    return this.finalize(flow, cls, "allowed", `${cls.reason}; stock firmware has no local-input ACL — management surface reachable`, null, [], cpuCost, this.routedAirtime(), labels, collected, null, null);
  }

  private evaluateInbound(
    flow: Flow,
    src: DeviceModel,
    dst: DeviceModel,
    cls: Classification,
    labels: string[],
    emit: EmitFn
  ): FlowResult {
    const collected: SimEvent[] = [];
    const srcIp = src.ipv4 ?? "";
    const dstIp = dst.ipv4 ?? "";
    const port = flow.dstPort;
    const cpuCost = this.routedCpu();

    const returning = this.connections.lookupReturn(flow.protocol, srcIp, dstIp, flow.dstPort);
    if (returning) {
      this.connections.confirm(returning.id, this.clock.now);
      collected.push(
        emit("conntrack", "info", `return traffic matched connection ${returning.id} (${returning.state})`, "estimate")
      );
      const txDrop = this.txAdmission(flow, cls, cpuCost, this.routedAirtime(), labels, collected);
    if (txDrop) return txDrop;
    this.counters.allowed += 1;
      return this.finalize(
        flow,
        cls,
        "allowed",
        `conntrack: return traffic for connection ${returning.id} (${returning.protocol} ${returning.srcIp} → ${returning.dstIp})`,
        "conntrack:established",
        [],
        cpuCost,
        0,
        labels,
        collected,
        "ESTABLISHED",
        null
      );
    }

    if (port === null || (flow.protocol !== "TCP" && flow.protocol !== "UDP")) {
      collected.push(emit("conntrack", "warn", "non-port protocol cannot traverse NAPT", "estimate"));
      this.counters.dropped += 1;
      return this.finalize(flow, cls, "dropped", "NAT boundary: no port-forward exists and this protocol cannot be mapped", null, [], cpuCost, 0, labels, collected, "INVALID", null);
    }

    const gateway = this.gatewayDevice();
    const router = this.routerDevice();
    const gatewayForward = this.findForward(gateway.id, port, flow.protocol);
    if (!gatewayForward) {
      collected.push(
        emit("nat", "warn", `no port-forward on ${gateway.name} for ${this.project.sim.publicIp}:${port}`, "estimate")
      );
      labels.push("double NAT — an inbound port-forward is required on both routers");
      this.counters.dropped += 1;
      return this.finalize(flow, cls, "dropped", `NAT boundary: upstream home router drops ${this.project.sim.publicIp}:${port} — no port-forward configured`, null, [], cpuCost, 0, labels, collected, "INVALID", null);
    }

    const espForward = this.findForward(router.id, gatewayForward.internalPort, flow.protocol);
    if (!espForward) {
      collected.push(emit("nat", "warn", `no DNAT mapping on ${router.name} for port ${gatewayForward.internalPort}`, "estimate"));
      this.counters.dropped += 1;
      return this.finalize(flow, cls, "dropped", `NAT boundary: ${router.name} has no DNAT mapping for port ${gatewayForward.internalPort}`, null, [], cpuCost, 0, labels, collected, "INVALID", null);
    }

    const internal = this.device(espForward.internalDeviceId);
    if (!internal.online) {
      this.counters.dropped += 1;
      return this.finalize(flow, cls, "dropped", `port-forward target ${internal.name} is offline`, null, [], cpuCost, 0, labels, collected, "INVALID", null);
    }

    const ctx: RuleEvalContext = {
      protocol: flow.protocol,
      srcIp,
      dstIp: internal.ipv4 ?? dstIp,
      srcPort: flow.srcPort,
      dstPort: espForward.internalPort,
      srcZone: src.zone,
      dstZone: internal.zone,
      inInterface: "wan0",
      outInterface: "guest0",
      connState: "NEW",
      devices: this.project.devices
    };
    const decision =
      this.project.firewall.dialect === "stock-4list"
        ? evaluateStockAclList(this.project.firewall.stockAcl.uplinkToGuest, flow.protocol, espForward.internalPort, srcIp)
        : evaluateFirewall(this.project.firewall, ctx);
    if (decision.matchedRuleId) {
      this.ruleHits.set(decision.matchedRuleId, (this.ruleHits.get(decision.matchedRuleId) ?? 0) + 1);
    }
    if (decision.action === "drop" || decision.action === "reject") {
      collected.push(emit("firewall", "warn", `policy blocked forwarded port: ${decision.ruleLabel}`, "datasheet"));
      this.counters.denied += 1;
      return this.finalize(flow, cls, "denied", `port-forward exists but ${decision.ruleLabel} blocks it`, decision.matchedRuleId, [], cpuCost, 0, labels, collected, "INVALID", null);
    }

    const chain: NatHop[] = [
      {
        hostId: gateway.id,
        hostName: gateway.name,
        fromIp: this.project.sim.publicIp,
        fromPort: port,
        toIp: this.wanIp(),
        toPort: gatewayForward.internalPort
      },
      {
        hostId: router.id,
        hostName: router.name,
        fromIp: this.wanIp(),
        fromPort: espForward.externalPort,
        toIp: internal.ipv4 ?? "",
        toPort: espForward.internalPort
      }
    ];

    const ramBlocked = this.ramAllocationBlocked(flow, cls, labels, collected, chain, emit);
    if (ramBlocked) return ramBlocked;

    const created = this.connections.create(
      flow.protocol,
      srcIp,
      flow.srcPort,
      internal.ipv4 ?? dstIp,
      espForward.internalPort,
      "dnat",
      router.id,
      this.clock.now,
      { dstIp: internal.ipv4 ?? dstIp, dstPort: espForward.internalPort }
    );
    if (!created) {
      collected.push(emit("conntrack", "warn", `connection table full (${this.connections.capacity}) — forwarded flow dropped`, "assumption"));
      labels.push("connection table exhausted");
      this.counters.dropped += 1;
      return this.finalize(flow, cls, "dropped", "connection tracking table full — inbound forwarded flow dropped", null, chain, cpuCost, 0, labels, collected, "INVALID", null);
    }

    labels.push("inbound port-forward exposes an internal service to the internet");
    if (espForward.note) labels.push(espForward.note);
    collected.push(
      emit("conntrack", "info", `DNAT ${this.project.sim.publicIp}:${port} → ${internal.ipv4 ?? dstIp}:${espForward.internalPort} (new connection ${created.id})`, "estimate")
    );
    collected.push(
      emit("firewall", "warn", `port-forward ${espForward.name} is explicit configuration — it creates an inbound opening; review exposure`, "datasheet")
    );
    const txDrop = this.txAdmission(flow, cls, cpuCost, this.routedAirtime(), labels, collected);
    if (txDrop) return txDrop;
    this.counters.allowed += 1;
    return this.finalize(
      flow,
      cls,
      "allowed",
      `double NAT DNAT chain matched: ${gateway.name} ${port} → ${router.name} ${espForward.externalPort} → ${internal.name}:${espForward.internalPort}${decision.matchedRuleId ? `; ${decision.ruleLabel}` : "; forward implies allow"}`,
      decision.matchedRuleId ?? "port-forward:explicit",
      chain,
      cpuCost,
      0,
      labels,
      collected,
      "NEW",
      `NAT chain resolves to ${internal.name} on the guest network`
    );
  }

  private evaluateOutbound(
    flow: Flow,
    src: DeviceModel,
    dst: DeviceModel,
    cls: Classification,
    labels: string[],
    emit: EmitFn
  ): FlowResult {
    const collected: SimEvent[] = [];
    const srcIp = src.ipv4 ?? "";
    const dstIp = dst.ipv4 ?? "";
    const cpuCost = this.routedCpu();
    const connState: ConnState = flow.forcedConnState ?? "NEW";

    if (this.project.firewall.dialect === "stateful" && connState === "INVALID") {
      collected.push(emit("conntrack", "warn", "invalid connection state — dropped before rule evaluation", "estimate"));
      labels.push("invalid state dropped under stateful filtering");
      this.counters.denied += 1;
      return this.finalize(flow, cls, "denied", "conntrack: invalid connection state — stateful firewall drops before rules match", "conntrack:invalid", [], cpuCost, this.routedAirtime(), labels, collected, "INVALID", null);
    }

    const established = this.connections.lookupForward(flow.protocol, srcIp, flow.srcPort, dstIp, flow.dstPort);
    if (established) {
      this.connections.confirm(established.id, this.clock.now);
      collected.push(emit("conntrack", "info", `existing connection ${established.id} — established flows bypass rule evaluation`, "estimate"));
      return this.forwardOutbound(flow, src, dst, cls, labels, collected, emit, "conntrack:established", "ESTABLISHED", null, established.translatedSrcPort, "existing flow follows its conntrack/NAPT mapping");
    }

    const dnatReturn = this.connections.lookupReturn(flow.protocol, srcIp, dstIp, flow.dstPort);
    if (dnatReturn && dnatReturn.kind === "dnat") {
      this.connections.confirm(dnatReturn.id, this.clock.now);
      collected.push(
        emit("conntrack", "info", `reply for forwarded connection ${dnatReturn.id} — reverse DNAT applied`, "estimate")
      );
      const txDrop = this.txAdmission(flow, cls, cpuCost, this.routedAirtime(), labels, collected);
    if (txDrop) return txDrop;
    this.counters.allowed += 1;
      return this.finalize(
        flow,
        cls,
        "allowed",
        `conntrack: reply for port-forwarded connection ${dnatReturn.id} (${dnatReturn.srcIp}:${dnatReturn.srcPort} → ${dnatReturn.dstIp}:${dnatReturn.dstPort})`,
        "conntrack:established",
        [],
        cpuCost,
        0,
        labels,
        collected,
        "ESTABLISHED",
        null
      );
    }

    const ctx: RuleEvalContext = {
      protocol: flow.protocol,
      srcIp,
      dstIp,
      srcPort: flow.srcPort,
      dstPort: flow.dstPort,
      srcZone: src.zone,
      dstZone: dst.zone,
      inInterface: "guest0",
      outInterface: "wan0",
      connState,
      devices: this.project.devices
    };
    let decision: RuleDecision;
    let devicePolicyNote: string | null = null;

    if (this.project.firewall.dialect === "stock-4list") {
      decision = evaluateFirewall(this.project.firewall, ctx);
      if (decision.action === "allow" && decision.matchedRuleId === null) {
        labels.push("no egress filtering on stock — default allow");
      }
    } else if (this.project.firewall.dialect === "none") {
      decision = evaluateFirewall(this.project.firewall, ctx);
    } else {
      const egress = evaluateDeviceEgress(src.egressPolicyId, {
        dstIp,
        dstPort: flow.dstPort,
        protocol: flow.protocol,
        vendorEndpoints: src.vendorEndpoints
      });
      devicePolicyNote = egress.ruleLabel;
      if (egress.action === "drop") {
        decision = { action: "drop", matchedRuleId: egress.matchedRule, ruleLabel: egress.ruleLabel, trace: [] };
      } else {
        decision = evaluateFirewall(this.project.firewall, ctx);
        if (decision.matchedRuleId === null) {
          decision = { action: "allow", matchedRuleId: egress.matchedRule, ruleLabel: egress.ruleLabel, trace: [] };
        }
      }
    }

    for (const step of decision.trace) {
      if (step.result === "match") this.ruleHits.set(step.ruleId, (this.ruleHits.get(step.ruleId) ?? 0) + 1);
    }
    if (decision.matchedRuleId) {
      this.ruleHits.set(decision.matchedRuleId, (this.ruleHits.get(decision.matchedRuleId) ?? 0) + 1);
    }

    if (decision.action === "allow" && decision.matchedRuleId) {
      const limit = this.rateLimitFor(decision.matchedRuleId, this.clock.now);
      if (limit && limit.exceeded) {
        collected.push(emit("firewall", "warn", `rule ${decision.ruleLabel} rate limit ${limit.limit}/s exceeded`, "assumption"));
        labels.push(`rate limit ${limit.limit}/s enforced`);
        this.counters.denied += 1;
        return this.finalize(flow, cls, "denied", `rate limit: ${decision.ruleLabel} allows ${limit.limit} packet(s)/s — excess dropped`, decision.matchedRuleId, [], cpuCost, this.routedAirtime(), labels, collected, "NEW", null);
      }
    }

    collected.push(
      emit(
        "firewall",
        decision.action === "allow" ? "ok" : "warn",
        `policy (${this.project.firewall.dialect}): ${decision.ruleLabel}${devicePolicyNote ? ` · ${devicePolicyNote}` : ""}`,
        decision.matchedRuleId ? "datasheet" : "measured"
      )
    );

    if (decision.action === "drop" || decision.action === "reject") {
      this.counters.denied += 1;
      return this.finalize(flow, cls, "denied", `${cls.reason}; denied by ${decision.ruleLabel}`, decision.matchedRuleId, [], cpuCost, this.routedAirtime(), labels, collected, "INVALID", null);
    }

    const wanIp = this.wanIp();
    const nat = this.translateOutboundNat(flow, srcIp, dstIp);
    if (!nat) {
      collected.push(emit("nat", "warn", `NAPT table full (${this.project.resources.naptCapacity}) — flow dropped`, "assumption"));
      labels.push("NAPT table exhausted");
      this.counters.dropped += 1;
      return this.finalize(flow, cls, "dropped", "NAPT table full — no free translation port", null, [], cpuCost, this.routedAirtime(), labels, collected, "NEW", null);
    }
    const guestMapping = nat.guest;
    const upstreamMapping = nat.upstream;
    const chain: NatHop[] = [
      {
        hostId: this.routerDevice().id,
        hostName: this.routerDevice().name,
        fromIp: srcIp,
        fromPort: flow.srcPort,
        toIp: wanIp,
        toPort: guestMapping.translatedSrcPort
      },
      {
        hostId: this.gatewayDevice().id,
        hostName: this.gatewayDevice().name,
        fromIp: wanIp,
        fromPort: guestMapping.translatedSrcPort,
        toIp: this.project.sim.publicIp,
        toPort: upstreamMapping.translatedSrcPort
      }
    ];
    labels.push("double NAT — upstream home router translates again");

    const ramBlocked = this.ramAllocationBlocked(flow, cls, labels, collected, chain, emit);
    if (ramBlocked) return ramBlocked;

    const created = this.connections.create(
      flow.protocol,
      srcIp,
      flow.srcPort,
      dstIp,
      flow.dstPort,
      "outbound",
      this.routerDevice().id,
      this.clock.now,
      { srcIp: wanIp, srcPort: guestMapping.translatedSrcPort }
    );
    if (!created) {
      collected.push(emit("conntrack", "warn", `connection table full (${this.connections.capacity}) — new flow dropped`, "assumption"));
      labels.push("connection table exhausted");
      this.counters.dropped += 1;
      return this.finalize(flow, cls, "dropped", "connection tracking table full — new flow dropped", null, chain, cpuCost, this.routedAirtime(), labels, collected, "NEW", null);
    }

    collected.push(emit("nat", "info", `NAPT ${srcIp}:${flow.srcPort ?? "*"} → ${wanIp}:${guestMapping.translatedSrcPort}`, "measured"));
    collected.push(
      emit("nat", "info", `upstream NAPT ${wanIp}:${guestMapping.translatedSrcPort} → ${this.project.sim.publicIp}:${upstreamMapping.translatedSrcPort}`, "estimate")
    );
    collected.push(emit("conntrack", "info", `connection ${created.id} created (${flow.protocol}, NEW)`, "estimate"));

    const route = this.routeLookup(dstIp);
    collected.push(emit("routing", "info", route.reason, "estimate"));

    if (!route.matched) {
      labels.push("no route — routing table has no path");
      this.counters.dropped += 1;
      return this.finalize(flow, cls, "dropped", `no route to ${dstIp}: ${route.reason}`, null, chain, cpuCost, this.routedAirtime(), labels, collected, "NEW", route.reason);
    }

    const upstream = this.upstreamReachability(dst.zone, dstIp);
    if (!upstream.reachable) {
      labels.push("no route — destination unreachable from the upstream network");
      this.counters.dropped += 1;
      return this.finalize(flow, cls, "dropped", upstream.reason, null, chain, cpuCost, this.routedAirtime(), labels, collected, "NEW", route.reason);
    }

    const txDrop = this.txAdmission(flow, cls, cpuCost, this.routedAirtime(), labels, collected);
    if (txDrop) return txDrop;
    this.counters.allowed += 1;
    return this.finalize(
      flow,
      cls,
      "allowed",
      `${cls.reason}; ${decision.ruleLabel}; ${route.reason}; upstream: ${upstream.reason}`,
      decision.matchedRuleId,
      chain,
      cpuCost,
      this.routedAirtime(),
      labels,
      collected,
      "NEW",
      route.reason
    );
  }

  private forwardOutbound(
    flow: Flow,
    src: DeviceModel,
    dst: DeviceModel,
    cls: Classification,
    labels: string[],
    collected: SimEvent[],
    emit: EmitFn,
    matchedRule: string,
    connState: ConnState,
    routeNote: string | null,
    translatedSrcPort: number | null,
    reason: string
  ): FlowResult {
    const srcIp = src.ipv4 ?? "";
    const dstIp = dst.ipv4 ?? "";
    const wanIp = this.wanIp();
    const nat = this.translateOutboundNat(flow, srcIp, dstIp);
    if (!nat) {
      collected.push(emit("nat", "warn", `NAPT table full (${this.project.resources.naptCapacity}) — flow dropped`, "assumption"));
      labels.push("NAPT table exhausted");
      this.counters.dropped += 1;
      return this.finalize(flow, cls, "dropped", "NAPT table full — no free translation port", null, [], this.routedCpu(), this.routedAirtime(), labels, collected, "ESTABLISHED", null);
    }
    const guestMapping = nat.guest;
    const upstreamMapping = nat.upstream;
    const chain: NatHop[] = [
      {
        hostId: this.routerDevice().id,
        hostName: this.routerDevice().name,
        fromIp: srcIp,
        fromPort: flow.srcPort,
        toIp: wanIp,
        toPort: guestMapping.translatedSrcPort
      },
      {
        hostId: this.gatewayDevice().id,
        hostName: this.gatewayDevice().name,
        fromIp: wanIp,
        fromPort: guestMapping.translatedSrcPort,
        toIp: this.project.sim.publicIp,
        toPort: upstreamMapping.translatedSrcPort
      }
    ];
    const route = this.routeLookup(dstIp);
    emit("routing", "info", route.reason, "estimate");
    if (!route.matched) {
      this.counters.dropped += 1;
      return this.finalize(
        flow,
        cls,
        "dropped",
        `no route to ${dstIp}: ${route.reason}`,
        "conntrack:established",
        chain,
        this.routedCpu(),
        this.routedAirtime(),
        labels,
        collected,
        "ESTABLISHED",
        route.reason
      );
    }
    const cpuCost = this.routedCpu();
    const txDrop = this.txAdmission(flow, cls, cpuCost, this.routedAirtime(), labels, collected);
    if (txDrop) return txDrop;
    this.counters.allowed += 1;
    return this.finalize(
      flow,
      cls,
      "allowed",
      `${reason}${translatedSrcPort !== null ? ` (guest NAPT port ${translatedSrcPort})` : ""}`,
      matchedRule,
      chain,
      this.routedCpu(),
      this.routedAirtime(),
      labels,
      collected,
      connState,
      routeNote ?? route.reason
    );
  }

  private translateOutboundNat(flow: Flow, srcIp: string, dstIp: string): { guest: NaptMapping; upstream: NaptMapping } | null {
    const wanIp = this.wanIp();
    try {
      const guest = this.guestNat.translateOutbound(flow.protocol, srcIp, flow.srcPort, dstIp, flow.dstPort);
      const upstream = this.upstreamNat.translateOutbound(flow.protocol, wanIp, guest.translatedSrcPort, dstIp, flow.dstPort);
      return { guest, upstream };
    } catch (error) {
      if (error instanceof NatTableFullError) return null;
      throw error;
    }
  }

  private findForward(routerId: string, externalPort: number, protocol: Flow["protocol"]): PortForwardModel | null {
    return (
      this.project.portForwards.find(
        (forward) =>
          forward.enabled &&
          forward.routerId === routerId &&
          forward.externalPort === externalPort &&
          forward.protocol === protocol
      ) ?? null
    );
  }

  private rateLimitFor(ruleId: string, now: number): { limit: number; exceeded: boolean } | null {
    const rule = this.project.firewall.rules.find((r) => r.id === ruleId);
    if (!rule || !rule.rateLimitPerSec || rule.rateLimitPerSec <= 0) return null;
    const window = this.rateWindows.get(ruleId) ?? { windowStart: now, count: 0 };
    if (now - window.windowStart >= RATE_WINDOW_MS) {
      window.windowStart = now;
      window.count = 0;
    }
    window.count += 1;
    this.rateWindows.set(ruleId, window);
    return { limit: rule.rateLimitPerSec, exceeded: window.count > rule.rateLimitPerSec };
  }

  private upstreamReachability(dstZone: string, dstIp: string): { reachable: boolean; reason: string } {
    if (dstZone === "internet") {
      return { reachable: true, reason: `default route to the internet via ${this.project.sim.publicIp}` };
    }
    if (dstZone === "upstream") {
      return { reachable: true, reason: "destination is inside the upstream LAN (same segment after NAT)" };
    }
    const zone = this.project.zones.find((z) => z.id === dstZone);
    const zoneIface = this.project.interfaces.find((i) => i.zone === dstZone);
    const label = zone ? zone.name : dstZone;
    return {
      reachable: false,
      reason: `upstream router has no route to ${dstIp} — ${label} is not reachable through the internet path${zoneIface && !zoneIface.up ? ` (interface ${zoneIface.id} is down)` : ""}`
    };
  }

  effectiveRoutes(): RouteModel[] {
    const routes: RouteModel[] = [];
    for (const iface of this.project.interfaces) {
      if (!iface.up) continue;
      const connected = connectedRouteFor(iface);
      if (connected) routes.push(connected);
    }
    routes.push(...this.project.routes);
    return routes;
  }

  routeLookup(dstIp: string): RouteLookup {
    return lookupRoute(dstIp, this.effectiveRoutes(), this.project.interfaces);
  }

  private finalize(
    flow: Flow,
    cls: Classification,
    verdict: FlowResult["verdict"],
    reason: string,
    matchedRule: string | null,
    natChain: NatHop[],
    cpuCost: number,
    airtimeCost: number,
    labels: string[],
    events: SimEvent[],
    connState: FlowResult["connState"],
    route: string | null
  ): FlowResult {
    events.push(
      this.emit("pipeline", verdict === "allowed" ? "ok" : "warn", `${verdict.toUpperCase()} — ${reason}`, "estimate", {
        flowId: flow.id
      })
    );
    return {
      flow,
      scope: cls.scope,
      visibleToFirewall: cls.visibleToFirewall,
      enforcementPoint: cls.enforcementPoint,
      verdict,
      reason,
      matchedRule,
      natChain,
      cpuCost,
      airtimeCost,
      labels,
      events,
      connState,
      route
    };
  }

  private routedCpu(): number {
    return this.firmware.uplink === "wifi" ? this.cal.cpuCostWifiUplink : this.cal.cpuCostEthernet;
  }

  private routedAirtime(): number {
    return this.firmware.uplink === "wifi" ? this.cal.airtimeRoutedWifi : this.cal.airtimeRoutedEthernet;
  }

  private device(id: string): DeviceModel {
    const device = this.project.devices.find((d) => d.id === id);
    if (!device) throw new Error(`unknown device: ${id}`);
    return device;
  }

  private routerDevice(): DeviceModel {
    const router = this.project.devices.find((d) => d.isRouter);
    if (!router) throw new Error("project has no router device");
    return router;
  }

  private gatewayDevice(): DeviceModel {
    const gateway = this.project.devices.find((d) => d.gateway);
    if (!gateway) throw new Error("project has no gateway device");
    return gateway;
  }

  private wanIp(): string {
    const wan = this.project.interfaces.find((i) => i.kind === "ethernet");
    return wan?.ipv4 ?? "0.0.0.0";
  }

  private emit(
    category: EventCategory,
    severity: EventSeverity,
    message: string,
    provenance: Provenance,
    extra?: Partial<SimEvent>
  ): SimEvent {
    return this.events.emit({ ts: this.clock.now, category, severity, message, provenance, ...extra });
  }
}
