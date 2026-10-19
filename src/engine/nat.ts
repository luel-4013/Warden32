import type { Protocol } from "./types";

export const NAPT_PORT_RANGE_START = 49152;
export const NAPT_PORT_RANGE_END = 65535;
export const NAPT_DEFAULT_CAPACITY = 2048;

export interface NaptMapping {
  protocol: Protocol;
  originalSrcIp: string;
  originalSrcPort: number | null;
  originalDstIp: string;
  originalDstPort: number | null;
  translatedSrcIp: string;
  translatedSrcPort: number;
  packets: number;
}

export class NatTableFullError extends Error {
  constructor(hostId: string) {
    super(`NAPT table of ${hostId} is full`);
    this.name = "NatTableFullError";
  }
}

export class NaptTable {
  private readonly mappings = new Map<string, NaptMapping>();
  private readonly usedPorts = new Set<number>();
  private nextPort = NAPT_PORT_RANGE_START;

  constructor(
    readonly hostId: string,
    readonly translatedIp: string,
    readonly capacity: number = NAPT_DEFAULT_CAPACITY
  ) {}

  get size(): number {
    return this.mappings.size;
  }

  get mappingsList(): NaptMapping[] {
    return [...this.mappings.values()];
  }

  translateOutbound(
    protocol: Protocol,
    srcIp: string,
    srcPort: number | null,
    dstIp: string,
    dstPort: number | null
  ): NaptMapping {
    const key = `${protocol}|${srcIp}|${srcPort ?? 0}|${dstIp}|${dstPort ?? 0}`;
    const existing = this.mappings.get(key);
    if (existing) {
      existing.packets += 1;
      return existing;
    }
    if (this.mappings.size >= this.capacity) throw new NatTableFullError(this.hostId);
    const port = this.allocatePort();
    const mapping: NaptMapping = {
      protocol,
      originalSrcIp: srcIp,
      originalSrcPort: srcPort,
      originalDstIp: dstIp,
      originalDstPort: dstPort,
      translatedSrcIp: this.translatedIp,
      translatedSrcPort: port,
      packets: 1
    };
    this.mappings.set(key, mapping);
    return mapping;
  }

  lookupInbound(translatedPort: number): NaptMapping | null {
    for (const mapping of this.mappings.values()) {
      if (mapping.translatedSrcPort === translatedPort) return mapping;
    }
    return null;
  }

  private allocatePort(): number {
    while (this.usedPorts.has(this.nextPort)) {
      this.nextPort += 1;
      if (this.nextPort > NAPT_PORT_RANGE_END) this.nextPort = NAPT_PORT_RANGE_START;
    }
    const port = this.nextPort;
    this.usedPorts.add(port);
    this.nextPort += 1;
    if (this.nextPort > NAPT_PORT_RANGE_END) this.nextPort = NAPT_PORT_RANGE_START;
    return port;
  }
}
