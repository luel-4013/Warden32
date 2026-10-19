import type { SimEngine } from "./engine";

export interface FailureResult {
  ok: boolean;
  message: string;
}

export interface FailureInjection {
  id: string;
  name: string;
  description: string;
  apply: (engine: SimEngine) => FailureResult;
}

export const FAILURE_INJECTIONS: FailureInjection[] = [
  {
    id: "uplink-down",
    name: "WAN link down",
    description: "Cuts the ethernet uplink — the ESP32 loses its default route and all routed traffic is dropped.",
    apply: (engine) => {
      engine.setLinkState("wan0", false);
      return { ok: true, message: "wan0 is down — routed traffic now fails with no route" };
    }
  },
  {
    id: "guest-ap-down",
    name: "Guest AP down",
    description: "Stops the SoftAP — client traffic never enters the router.",
    apply: (engine) => {
      engine.setLinkState("guest0", false);
      return { ok: true, message: "guest0 is down — guest clients are disconnected" };
    }
  },
  {
    id: "ram-pressure",
    name: "RAM pressure",
    description: "Squeezes the heap budget so new connection allocations start failing (estimates stay conservative).",
    apply: (engine) => {
      engine.project.resources.ramOverrideKb = 190;
      return { ok: true, message: "heap budget clamped to 190 KB — new connections will be refused once exhausted" };
    }
  },
  {
    id: "tx-queue-pressure",
    name: "TX queue pressure",
    description: "Shrinks the transmit queue so bursts overflow the buffer model.",
    apply: (engine) => {
      engine.project.resources.txQueueLength = 4;
      return { ok: true, message: "tx queue length clamped to 4 — bursts will overflow" };
    }
  },
  {
    id: "napt-exhaustion",
    name: "NAPT table exhaustion",
    description: "Shrinks the NAT port table. Capacity binds at engine start, so this applies to the next rebuild.",
    apply: (engine) => {
      engine.project.resources.naptCapacity = 8;
      return { ok: true, message: "NAPT capacity set to 8 — applies when the engine is rebuilt" };
    }
  },
  {
    id: "dns-offline",
    name: "Upstream DNS outage",
    description: "Takes the DNS resolver offline — devices that dial by name cannot resolve.",
    apply: (engine) => {
      engine.setDeviceOnline("dns-server", false);
      return { ok: true, message: "dns-server is offline" };
    }
  },
  {
    id: "cpu-pressure",
    name: "CPU saturation",
    description: "Not injectable: CPU load is an output of replayed traffic, not a setting. Replay a noisy device instead.",
    apply: () => ({
      ok: false,
      message: "CPU load cannot be injected — set a device to the noisy state and replay its profile"
    })
  }
];

export function failureById(id: string): FailureInjection | null {
  return FAILURE_INJECTIONS.find((injection) => injection.id === id) ?? null;
}

export function injectFailure(engine: SimEngine, id: string): FailureResult {
  const injection = failureById(id);
  if (!injection) return { ok: false, message: `unknown failure injection: ${id}` };
  return injection.apply(engine);
}
