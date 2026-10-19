import { describe, expect, it } from "vitest";
import { ConnTrackTable, TCP_ESTABLISHED_TIMEOUT_MS, UDP_TIMEOUT_MS } from "./conntrack";

describe("connection tracking table", () => {
  it("creates a NEW entry and confirms it to ESTABLISHED with a longer timeout", () => {
    const table = new ConnTrackTable(16);
    const entry = table.create("TCP", "10.0.0.11", 41000, "203.0.113.65", 443, "outbound", "esp32", 0);
    expect(entry).not.toBeNull();
    expect(entry!.state).toBe("NEW");
    expect(table.size).toBe(1);

    const confirmed = table.confirm(entry!.id, 50);
    expect(confirmed!.state).toBe("ESTABLISHED");
    expect(confirmed!.timeoutMs).toBe(TCP_ESTABLISHED_TIMEOUT_MS);
  });

  it("matches return traffic by reverse tuple", () => {
    const table = new ConnTrackTable(16);
    const entry = table.create("TCP", "10.0.0.11", 41000, "203.0.113.65", 443, "outbound", "esp32", 0)!;
    expect(table.lookupReturn("TCP", "203.0.113.65", "10.0.0.11", 41000)?.id).toBe(entry.id);
    expect(table.lookupReturn("TCP", "203.0.113.66", "10.0.0.11", 41000)).toBeNull();
    expect(table.lookupReturn("UDP", "203.0.113.65", "10.0.0.11", 41000)).toBeNull();
  });

  it("reuses an existing forward entry instead of allocating a second row", () => {
    const table = new ConnTrackTable(16);
    const first = table.create("UDP", "10.0.0.14", 5353, "203.0.113.53", 53, "outbound", "esp32", 0)!;
    const second = table.create("UDP", "10.0.0.14", 5353, "203.0.113.53", 53, "outbound", "esp32", 10)!;
    expect(second.id).toBe(first.id);
    expect(table.size).toBe(1);
    expect(second.packets).toBe(2);
    expect(second.state).toBe("ESTABLISHED");
  });

  it("expires entries after their timeout", () => {
    const table = new ConnTrackTable(16);
    table.create("UDP", "10.0.0.14", 5353, "203.0.113.53", 53, "outbound", "esp32", 0);
    expect(table.expire(UDP_TIMEOUT_MS - 1)).toHaveLength(0);
    const expired = table.expire(UDP_TIMEOUT_MS + 1);
    expect(expired).toHaveLength(1);
    expect(expired[0].state).toBe("EXPIRED");
    expect(table.size).toBe(0);
  });

  it("enforces capacity", () => {
    const table = new ConnTrackTable(1);
    expect(table.create("TCP", "10.0.0.11", 41000, "203.0.113.65", 443, "outbound", "esp32", 0)).not.toBeNull();
    expect(table.create("TCP", "10.0.0.12", 41000, "203.0.113.65", 443, "outbound", "esp32", 0)).toBeNull();
    expect(table.size).toBe(1);
  });

  it("clears the table and reports the removed count", () => {
    const table = new ConnTrackTable(4);
    table.create("TCP", "10.0.0.11", 41000, "203.0.113.65", 443, "outbound", "esp32", 0);
    table.create("TCP", "10.0.0.12", 41001, "203.0.113.65", 443, "outbound", "esp32", 0);
    expect(table.clear()).toBe(2);
    expect(table.size).toBe(0);
  });
});
