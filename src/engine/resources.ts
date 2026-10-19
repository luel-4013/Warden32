import type { ProjectModel } from "./model";
import type { Provenance } from "./types";
import { RAM_BASE_KB } from "./calibrationDefaults";

export { RAM_BASE_KB };
export const RAM_PER_CONNECTION_KB = 0.2;
export const RAM_PER_NAPT_KB = 0.15;
export const RAM_PER_BUFFER_KB = 1.6;
export const CPU_UNITS_PER_SECOND = 12;
export const AIRTIME_UNITS_PER_SECOND = 10;
export const TX_DRAIN_PER_SECOND = 50;
export const WINDOW_MS = 1000;

export interface ResourceSnapshot {
  ramUsedKb: number;
  ramLimitKb: number;
  ramExhausted: boolean;
  conntrackUsed: number;
  conntrackCapacity: number;
  naptUsed: number;
  naptCapacity: number;
  cpuLoadPct: number;
  airtimePct: number;
  txQueueDepth: number;
  txQueueCapacity: number;
  buffersFree: number;
  bufferCount: number;
  provenance: Provenance;
}

interface Sample {
  ts: number;
  cost: number;
}

export class ResourceTracker {
  private cpuWindow: Sample[] = [];
  private airtimeWindow: Sample[] = [];
  private txQueueDepth = 0;
  private lastNow = 0;

  constructor(private readonly project: ProjectModel, private readonly baseRamKb: number = RAM_BASE_KB) {}

  get txDepth(): number {
    return this.txQueueDepth;
  }

  enqueue(now: number, cpuCost: number, airtimeCost: number): { overflowed: boolean } {
    this.cpuWindow.push({ ts: now, cost: cpuCost });
    this.airtimeWindow.push({ ts: now, cost: airtimeCost });
    this.txQueueDepth += 1;
    const capacity = this.project.resources.txQueueLength;
    if (this.txQueueDepth > capacity) return { overflowed: true };
    return { overflowed: false };
  }

  advance(now: number): void {
    const delta = Math.max(0, now - this.lastNow);
    this.lastNow = now;
    const drained = Math.ceil((TX_DRAIN_PER_SECOND * delta) / 1000);
    this.txQueueDepth = Math.max(0, this.txQueueDepth - drained);
    this.cpuWindow = this.cpuWindow.filter((sample) => now - sample.ts <= WINDOW_MS);
    this.airtimeWindow = this.airtimeWindow.filter((sample) => now - sample.ts <= WINDOW_MS);
  }

  cpuLoadPct(now: number): number {
    const total = this.cpuWindow
      .filter((sample) => now - sample.ts <= WINDOW_MS)
      .reduce((sum, sample) => sum + sample.cost, 0);
    return Math.round((total / CPU_UNITS_PER_SECOND) * 100);
  }

  airtimePct(now: number): number {
    const total = this.airtimeWindow
      .filter((sample) => now - sample.ts <= WINDOW_MS)
      .reduce((sum, sample) => sum + sample.cost, 0);
    return Math.round((total / AIRTIME_UNITS_PER_SECOND) * 100);
  }

  ramUsedKb(conntrackUsed: number, naptUsed: number): number {
    const buffers = Math.min(this.txQueueDepth, this.project.resources.bufferCount);
    const used =
      this.baseRamKb +
      conntrackUsed * RAM_PER_CONNECTION_KB +
      naptUsed * RAM_PER_NAPT_KB +
      buffers * RAM_PER_BUFFER_KB;
    return Math.round(used * 10) / 10;
  }

  ramLimitKb(ramKb: number): number {
    return this.project.resources.ramOverrideKb ?? ramKb;
  }

  snapshot(
    now: number,
    params: { ramKb: number; conntrackUsed: number; conntrackCapacity: number; naptUsed: number }
  ): ResourceSnapshot {
    const limit = this.ramLimitKb(params.ramKb);
    const used = this.ramUsedKb(params.conntrackUsed, params.naptUsed);
    return {
      ramUsedKb: used,
      ramLimitKb: limit,
      ramExhausted: used > limit,
      conntrackUsed: params.conntrackUsed,
      conntrackCapacity: params.conntrackCapacity,
      naptUsed: params.naptUsed,
      naptCapacity: this.project.resources.naptCapacity,
      cpuLoadPct: this.cpuLoadPct(now),
      airtimePct: this.airtimePct(now),
      txQueueDepth: this.txQueueDepth,
      txQueueCapacity: this.project.resources.txQueueLength,
      buffersFree: Math.max(0, this.project.resources.bufferCount - this.txQueueDepth),
      bufferCount: this.project.resources.bufferCount,
      provenance: "estimate"
    };
  }
}
