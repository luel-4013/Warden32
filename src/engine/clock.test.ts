import { describe, expect, it } from "vitest";
import { SimClock } from "./clock";

describe("SimClock", () => {
  it("fires timers in time order and breaks ties by insertion order", () => {
    const clock = new SimClock();
    const order: string[] = [];
    clock.schedule(20, "b", () => order.push("b"));
    clock.schedule(10, "a", () => order.push("a"));
    clock.schedule(20, "c", () => order.push("c"));
    clock.advanceTo(100);
    expect(order).toEqual(["a", "b", "c"]);
    expect(clock.now).toBe(100);
  });

  it("fires chained timers during the same advance", () => {
    const clock = new SimClock();
    const order: string[] = [];
    clock.schedule(10, "first", () => {
      order.push("first");
      clock.schedule(5, "second", () => order.push("second"));
    });
    clock.advanceTo(100);
    expect(order).toEqual(["first", "second"]);
  });

  it("does not fire timers beyond the target and supports cancel", () => {
    const clock = new SimClock();
    const order: string[] = [];
    clock.schedule(50, "late", () => order.push("late"));
    const cancelled = clock.schedule(10, "cancelled", () => order.push("cancelled"));
    clock.cancel(cancelled);
    clock.advanceTo(20);
    expect(order).toEqual([]);
    clock.advanceTo(60);
    expect(order).toEqual(["late"]);
  });

  it("is deterministic across identical schedules", () => {
    const run = (): number[] => {
      const clock = new SimClock();
      const fired: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        clock.schedule((i * 7) % 5, `t${i}`, () => fired.push(i));
      }
      clock.advanceTo(10);
      return fired;
    };
    expect(run()).toEqual(run());
  });
});
