import { describe, expect, it } from "vitest";
import { NAPT_PORT_RANGE_START, NaptTable, NatTableFullError } from "./nat";
import { mulberry32 } from "./rng";

describe("NAPT table", () => {
  it("allocates ports deterministically, reuses mappings, and enforces capacity", () => {
    const table = new NaptTable("esp32", "192.168.1.23", 2);
    const first = table.translateOutbound("TCP", "10.0.0.11", 41000, "203.0.113.65", 443);
    expect(first.translatedSrcPort).toBe(NAPT_PORT_RANGE_START);

    const reuse = table.translateOutbound("TCP", "10.0.0.11", 41000, "203.0.113.65", 443);
    expect(reuse.translatedSrcPort).toBe(NAPT_PORT_RANGE_START);
    expect(reuse.packets).toBe(2);

    const second = table.translateOutbound("TCP", "10.0.0.12", 41000, "203.0.113.65", 443);
    expect(second.translatedSrcPort).toBe(NAPT_PORT_RANGE_START + 1);

    expect(() => table.translateOutbound("TCP", "10.0.0.13", 41000, "203.0.113.65", 443)).toThrow(
      NatTableFullError
    );
  });

  it("looks up inbound mappings by translated port", () => {
    const table = new NaptTable("esp32", "192.168.1.23");
    const mapping = table.translateOutbound("UDP", "10.0.0.11", 5353, "198.51.100.53", 53);
    const found = table.lookupInbound(mapping.translatedSrcPort);
    expect(found?.originalSrcIp).toBe("10.0.0.11");
    expect(table.lookupInbound(1)).toBeNull();
  });
});

describe("seeded RNG", () => {
  it("produces identical sequences for identical seeds", () => {
    const a = mulberry32(1337);
    const b = mulberry32(1337);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
    expect(mulberry32(2)()).not.toBe(b());
  });
});
