export interface ScheduledTimer {
  id: number;
  seq: number;
  atMs: number;
  label: string;
  fn: () => void;
}

export class SimClock {
  private nowMs = 0;
  private seq = 0;
  private timers: ScheduledTimer[] = [];

  get now(): number {
    return this.nowMs;
  }

  get pendingCount(): number {
    return this.timers.length;
  }

  schedule(delayMs: number, label: string, fn: () => void): ScheduledTimer {
    const timer: ScheduledTimer = {
      id: this.seq,
      seq: this.seq,
      atMs: this.nowMs + delayMs,
      label,
      fn
    };
    this.seq += 1;
    this.timers.push(timer);
    return timer;
  }

  scheduleAt(atMs: number, label: string, fn: () => void): ScheduledTimer {
    return this.schedule(Math.max(0, atMs - this.nowMs), label, fn);
  }

  cancel(timer: ScheduledTimer): boolean {
    const before = this.timers.length;
    this.timers = this.timers.filter((t) => t !== timer);
    return this.timers.length !== before;
  }

  clear(): void {
    this.timers = [];
  }

  advanceTo(targetMs: number): ScheduledTimer[] {
    const fired: ScheduledTimer[] = [];
    if (targetMs < this.nowMs) throw new Error("clock cannot move backwards");
    for (;;) {
      const next = this.nextDue(targetMs);
      if (!next) break;
      this.timers = this.timers.filter((t) => t !== next);
      this.nowMs = next.atMs;
      next.fn();
      fired.push(next);
    }
    this.nowMs = targetMs;
    return fired;
  }

  private nextDue(limitMs: number): ScheduledTimer | null {
    let best: ScheduledTimer | null = null;
    for (const timer of this.timers) {
      if (timer.atMs > limitMs) continue;
      if (!best) {
        best = timer;
        continue;
      }
      if (timer.atMs < best.atMs) best = timer;
      else if (timer.atMs === best.atMs && timer.seq < best.seq) best = timer;
    }
    return best;
  }
}
