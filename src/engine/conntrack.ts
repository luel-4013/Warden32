import type { ConnState, Protocol } from "./types";

export const TCP_NEW_TIMEOUT_MS = 10_000;
export const TCP_ESTABLISHED_TIMEOUT_MS = 300_000;
export const TCP_CLOSING_TIMEOUT_MS = 10_000;
export const UDP_TIMEOUT_MS = 30_000;
export const DNAT_TIMEOUT_MS = 120_000;

export interface ConnEntry {
  id: number;
  protocol: Protocol;
  srcIp: string;
  srcPort: number | null;
  dstIp: string;
  dstPort: number | null;
  state: ConnState;
  kind: "outbound" | "dnat";
  brokerDeviceId: string;
  createdAt: number;
  lastSeenAt: number;
  packets: number;
  timeoutMs: number;
  translatedSrcIp: string | null;
  translatedSrcPort: number | null;
  translatedDstIp: string | null;
  translatedDstPort: number | null;
}

function baseTimeout(protocol: Protocol): number {
  return protocol === "UDP" ? UDP_TIMEOUT_MS : TCP_NEW_TIMEOUT_MS;
}

export class ConnTrackTable {
  private nextId = 1;
  private entries: ConnEntry[] = [];

  constructor(readonly capacity: number) {}

  get size(): number {
    return this.entries.length;
  }

  get all(): readonly ConnEntry[] {
    return this.entries;
  }

  snapshot(): ConnEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  lookupForward(
    protocol: Protocol,
    srcIp: string,
    srcPort: number | null,
    dstIp: string,
    dstPort: number | null
  ): ConnEntry | null {
    return (
      this.entries.find(
        (entry) =>
          entry.kind === "outbound" &&
          entry.protocol === protocol &&
          entry.srcIp === srcIp &&
          entry.srcPort === srcPort &&
          entry.dstIp === dstIp &&
          entry.dstPort === dstPort
      ) ?? null
    );
  }

  lookupReturn(
    protocol: Protocol,
    srcIp: string,
    dstIp: string,
    dstPort: number | null
  ): ConnEntry | null {
    return (
      this.entries.find(
        (entry) =>
          entry.protocol === protocol &&
          entry.dstIp === srcIp &&
          entry.srcIp === dstIp &&
          entry.srcPort === dstPort
      ) ?? null
    );
  }

  create(
    protocol: Protocol,
    srcIp: string,
    srcPort: number | null,
    dstIp: string,
    dstPort: number | null,
    kind: ConnEntry["kind"],
    brokerDeviceId: string,
    now: number,
    translated?: { srcIp?: string; srcPort?: number | null; dstIp?: string; dstPort?: number | null }
  ): ConnEntry | null {
    const existing = this.lookupForward(protocol, srcIp, srcPort, dstIp, dstPort);
    if (existing) {
      existing.packets += 1;
      existing.lastSeenAt = now;
      if (existing.state === "NEW") this.confirm(existing.id, now);
      return existing;
    }
    if (this.entries.length >= this.capacity) return null;
    const entry: ConnEntry = {
      id: this.nextId,
      protocol,
      srcIp,
      srcPort,
      dstIp,
      dstPort,
      state: "NEW",
      kind,
      brokerDeviceId,
      createdAt: now,
      lastSeenAt: now,
      packets: 1,
      timeoutMs: kind === "dnat" ? DNAT_TIMEOUT_MS : baseTimeout(protocol),
      translatedSrcIp: translated?.srcIp ?? null,
      translatedSrcPort: translated?.srcPort ?? null,
      translatedDstIp: translated?.dstIp ?? null,
      translatedDstPort: translated?.dstPort ?? null
    };
    this.nextId += 1;
    this.entries.push(entry);
    return entry;
  }

  confirm(id: number, now: number): ConnEntry | null {
    const entry = this.entries.find((e) => e.id === id) ?? null;
    if (!entry) return null;
    entry.state = "ESTABLISHED";
    entry.lastSeenAt = now;
    entry.timeoutMs = entry.protocol === "UDP" ? UDP_TIMEOUT_MS : TCP_ESTABLISHED_TIMEOUT_MS;
    return entry;
  }

  markClosing(id: number, now: number): ConnEntry | null {
    const entry = this.entries.find((e) => e.id === id) ?? null;
    if (!entry) return null;
    entry.state = "EXPIRED";
    entry.lastSeenAt = now;
    entry.timeoutMs = TCP_CLOSING_TIMEOUT_MS;
    return entry;
  }

  expire(now: number): ConnEntry[] {
    const expired: ConnEntry[] = [];
    this.entries = this.entries.filter((entry) => {
      if (now - entry.lastSeenAt > entry.timeoutMs) {
        expired.push({ ...entry, state: "EXPIRED" });
        return false;
      }
      return true;
    });
    return expired;
  }

  clear(): number {
    const count = this.entries.length;
    this.entries = [];
    return count;
  }
}
