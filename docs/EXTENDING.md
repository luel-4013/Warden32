# Extending Warden32

This document describes how to extend the lab with new device archetypes,
boards, Ethernet adapters, firmware profiles, attack scenarios, and traffic
profiles. Every example matches the interfaces that exist in this build.

Ground rules that apply to all sections:

- There is no runtime JSON-schema registry in this build. Registries are
  TypeScript data modules under `src/registry/` and `src/engine/traffic.ts`;
  "adding an item" still means editing a `.ts` file and running the tests.
  Unknown fields in *project files* round-trip untouched, but registry entries
  are checked at compile time only.
- The engine consumes device instances from the project (`DeviceModel`), not
  archetypes directly. The archetype registry is reference data for the
  Registry page; the traffic generator is driven by the project's
  `device.trafficProfileId`.
- There is no boolean "hypothetical" flag. The convention is
  `provenance: "assumption"`, which the Registry page renders as a
  `not implemented on hardware` chip whose tooltip reads *"hypothetical
  archetype — demo scaffolding with no measured hardware behavior"*.
- After any registry change, run `npm test` (144 tests) and
  `npm run typecheck`.

## 1. Add a device archetype

File: `src/registry/devices.ts`. Interface:

```ts
export interface DeviceArchetype {
  id: string;
  name: string;
  category: "iot" | "infrastructure" | "external";
  services: ServiceDef[];              // { name, port, protocol: "TCP" | "UDP" }
  managementPorts: number[];
  egressPolicyId: "vendor-only" | "allow-all" | "block-all";
  vendorEndpoints: VendorEndpoint[];   // { ip, protocol, ports, provenance }
  trafficProfileId: string;            // must exist in TRAFFIC_PROFILES, or "none"
  behaviorState: "normal" | "noisy" | "misconfigured";
  notes: string;                       // must be non-empty
  provenance: "measured" | "datasheet" | "paper" | "estimate" | "assumption";
}
```

Worked example (append to `DEVICE_ARCHETYPES`):

```ts
{
  id: "air-quality",
  name: "Air quality monitor",
  category: "iot",
  services: [{ name: "http", port: 80, protocol: "TCP" }],
  managementPorts: [80],
  egressPolicyId: "vendor-only",
  vendorEndpoints: DEMO_CLOUD,
  trafficProfileId: "sensor-small",
  behaviorState: "normal",
  notes: "Battery-class sensor; uploads on threshold events.",
  provenance: "paper"
}
```

Invariants enforced by `src/registry/devices.test.ts`:

| Invariant | Test |
| --- | --- |
| Unique `id`; `archetypeById` resolves | `has unique ids` |
| `iotArchetypes().length >= 15` (category `iot`) | `ships at least 15 IoT archetypes` |
| Non-`none` `trafficProfileId` exists in `TRAFFIC_PROFILES` | `references only existing traffic profiles` |
| `vendor-only` entries have at least one vendor endpoint | `gives vendor-only archetypes at least one vendor endpoint` |
| Service ports in 1–65535; valid provenance tag; non-empty notes | `declares valid ports and tags provenance` |

Consumers: `RegistryPage` (filterable table and demo-endpoint list) and
`TrafficPage`, which matches archetypes to project devices by exact device
`name` and only uses the match to explain a missing profile — it never
substitutes the registry value into the project. If you want a project device
to use the new archetype's traffic shape, set the device's `trafficProfileId`
in the project as well.

## 2. Add a hardware board

File: `src/registry/profiles.ts`. Interface:

```ts
export interface HardwareProfile {
  id: string;
  name: string;
  cores: string;
  clockMhz: number;
  wifi: string | null;          // null = no radio
  internalEmac: boolean;
  ethernetBus: string;          // e.g. "RMII", "SPI only", "none"
  ramKb: number;
  provenance: Provenance;       // datasheet values in the existing entries
  note: string;
}
```

Worked example (verify against the vendor datasheet before committing):

```ts
{
  id: "esp32-c5",
  name: "ESP32-C5",
  cores: "1× RISC-V",
  clockMhz: 240,
  wifi: "Wi-Fi 6 (dual-band)",
  internalEmac: false,
  ethernetBus: "SPI only",
  ramKb: 400,
  provenance: "datasheet",
  note: "No internal EMAC."
}
```

How it is consumed:

- `SimEngine` constructor resolves the board by id:
  `HARDWARE_PROFILES.find((b) => b.id === project.sim.boardId)`; an unknown id
  throws `unknown board: <id>`. Project validation only requires
  `sim.boardId` to be a string, so typos survive file validation and fail at
  engine construction.
- `board.ramKb` is the RAM model limit (overridable by
  `project.resources.ramOverrideKb`).
- `HardwarePage` builds the board table, the "use" action
  (`draft.sim.boardId = id`), and compatibility warnings: no internal EMAC vs
  RMII adapters, no Wi-Fi radio vs SoftAP/STA profiles. The engine itself does
  not reject incompatible combinations, only the page flags them.

There is no registry test for boards; if you add one, follow the shape of
`devices.test.ts` (unique ids, provenance tags, non-empty notes) and add a
behavioral case to `src/engine/engine.test.ts`.

## 3. Add an Ethernet adapter

File: `src/registry/profiles.ts`. Interface:

```ts
export interface EthernetAdapter {
  id: string;
  name: string;
  bus: "RMII" | "SPI" | "RGMII" | "none";
  nominalMbps: number;
  cpuCostPerPacket: number;
  requiresInternalEmac: boolean;
  provenance: Provenance;
  note: string;
}
```

Worked example:

```ts
{
  id: "ch390",
  name: "CH390-class SPI MAC+PHY",
  bus: "SPI",
  nominalMbps: 100,
  cpuCostPerPacket: 2.1,
  requiresInternalEmac: false,
  provenance: "estimate",
  note: "SPI MAC+PHY; throughput bound by the SPI clock."
}
```

How it is consumed:

- `SimEngine` resolves `sim.adapterId` with
  `ETHERNET_ADAPTERS.find(...)`; an unknown id throws
  `unknown adapter: <id>`.
- The status bar shows `link <adapter.name>`; `HardwarePage` shows the table
  and the `use` action.
- Honest wiring: `nominalMbps` and `cpuCostPerPacket` are registry display
  data. The routed CPU/airtime cost used by runs comes from the firmware
  uplink calibration (`CPU_ETHERNET` / `CPU_WIFI_UPLINK` and the airtime
  constants in `src/engine/calibrationDefaults.ts`), not from the adapter
  entry. Wiring adapter costs into the engine would be a behavioral change and
  must update `engine.test.ts` and `resources.test.ts`.

## 4. Add a firmware profile

This one is a code change, not only data:

1. Extend the union in `src/registry/profiles.ts`:
   `export type FirmwareProfileId = "stock-eth" | "stock-wifi" | "softap-sta" | "target-v1" | "your-id";`
2. Add the entry to `FIRMWARE_PROFILES` (`Record<FirmwareProfileId, FirmwareProfile>`):

```ts
export interface FirmwareProfile {
  id: FirmwareProfileId;
  name: string;
  uplink: "ethernet" | "wifi";
  acl: "stock-4list" | "none" | "stateful-default-deny";
  defaultPolicy: "allow" | "deny";
  dnsSinkhole: boolean;
  clientIsolation: boolean;
  implementedOnHardware: boolean;
  managementChannels: string[];
  naptCapacity: number;
  note: string;
}
```

3. Update the two dialect-mapping branches, because both are if/else chains
   with a stock fallback:
   - `src/app/store.tsx` → `applyFirmware` (sets `firewall.dialect` and
     `firewall.defaultPolicy` and the `sim.policyBaseline` label; clears
     results).
   - `src/engine/experiment.ts` → `runExperiment` (maps firmware to the
     cloned project's dialect; for `softap-sta` it sets dialect `none` and
     leaves `defaultPolicy` as-is, which is behaviorally equivalent because
     the `none` dialect bypasses filtering).
   A new profile that is not added to these chains silently inherits
   `stock-4list` + `allow`.
4. Check `src/engine/validation.ts` → `buildValidationChecklist`, which
   special-cases `firmware.id === "target-v1"` for the concurrent-clients
   expectation (`12` vs `8`).

Engine consumption details:

- `SimEngine` looks the profile up with `FIRMWARE_PROFILES[project.sim.firmwareId]`
  and dereferences it immediately (`this.firmware.name` in the startup event).
  Unlike boards and adapters this lookup is **not** guarded; a hand-edited
  project file with an unknown `firmwareId` passes `validateProject` and then
  fails at engine construction. Keep ids in the union and the record in sync.
- `firmware.uplink` selects routed CPU/airtime class
  (`cpuCostWifiUplink` vs `cpuCostEthernet`).
- `firmware.acl` drives the dialect branches inside `submitFlow`
  (`none` = no filtering; `stock-4list` = 4-list ACL; `stateful-default-deny` =
  target behavior, including serial-only management).
- `firmware.implementedOnHardware` adds the
  `not implemented on hardware` flow label everywhere.
- `firmware.managementChannels` feeds the
  `management surface reachable (...)` label.
- `firmware.naptCapacity` is **display-only** today: the engine builds NAPT
  tables from `project.resources.naptCapacity`.

Note the intentional vocabulary split: `FirmwareProfile.acl` uses
`"stateful-default-deny"` while `FirewallModel.dialect` uses `"stateful"`.
`store.applyFirmware` and `runExperiment` translate between them.

## 5. Add an attack scenario

File: `src/engine/attacks.ts`. Interface:

```ts
export type AttackCategory =
  | "recon" | "initial-access" | "lateral" | "c2" | "exfiltration" | "spoofing" | "dos";

export interface AttackScenario {
  id: string;
  name: string;
  category: AttackCategory;
  description: string;
  modeled: boolean;
  provenance: Provenance;
  build: (project: ProjectModel, startMs: number) => Flow[];
}
```

Worked example (`Flow` objects are constructed directly; the local `flow()`
helper is module-private):

```ts
{
  id: "ssdp-amplification",
  name: "SSDP amplification probe",
  category: "dos",
  description: "Spoofed SSDP queries against the public IP; dropped at the NAT boundary without forwards.",
  modeled: true,
  provenance: "assumption",
  build: (project, startMs) => {
    const has = (id: string) => project.devices.some((d) => d.id === id);
    if (!has("attacker") || !has("cam")) return [];
    return [0, 1, 2].map((i) => ({
      id: `ssdp-${i}`,
      label: "SSDP amplification probe",
      kind: "inbound" as const,
      timestampMs: startMs + i * 350,
      srcDeviceId: "attacker",
      dstDeviceId: "cam",
      protocol: "UDP" as const,
      srcPort: 60000 + i,
      dstPort: 1900
    }));
  }
}
```

Contract and invariants:

- `runScenario` calls `engine.advanceTo(flow.timestampMs)` for each flow **in
  array order** and submits each flow immediately. Timestamps must be
  non-decreasing; the virtual clock throws `clock cannot move backwards`
  otherwise. The array is not sorted for you.
- `build` must return `[]` when prerequisite devices are missing (existing
  scenarios early-return via a `hasDevice` guard). An empty result renders the
  "prerequisites missing" empty state, not an error.
- Unmodeled scenarios set `modeled: false` and `build: () => []`. The UI
  disables the run button and explains why; the lab deliberately does not fake
  unmodelable radio-layer behavior (`wifi-deauth`, `dhcp-starvation`).
- `src/engine/attacks.test.ts` enforces: unique ids, non-empty descriptions,
  valid provenance tags, and that unmodeled scenarios build empty. Add a
  behavioral case there for scenario-specific verdicts.

## 6. Add a traffic profile

File: `src/engine/traffic.ts` (inside `TRAFFIC_PROFILES`).

```ts
export interface TrafficStep {
  id: string;
  protocol: Flow["protocol"];   // "TCP" | "UDP" | "ICMP" | "ARP" | "IPv6" | "OTHER"
  target: string;               // logical target, resolved by the caller
  dstPort: number;
  intervalMs: number;
  jitterMs: number;
  baseSrcPort: number;
  label: string;
}

export interface TrafficProfile {
  id: string;
  name: string;
  description: string;
  provenance: Provenance;
  steps: TrafficStep[];
}
```

Worked example:

```ts
"air-quality-report": {
  id: "air-quality-report",
  name: "Air quality report",
  description: "Threshold-driven MQTT reports with hourly DNS refresh.",
  provenance: "assumption",
  steps: [
    step("report", "vendor-cloud", "TCP", 8883, 300000, 30000, 50000, "measurement"),
    step("resolve", "dns-server", "UDP", 53, 3600000, 60000, 50100, "resolve")
  ]
}
```

(`step()` is module-private; entries added outside this module must build the
same object shape by hand.)

How generation works (`generateProfileFlows`):

- Unknown `profileId` returns `[]` — this is the behavior the Traffic page
  surfaces as a "profile is not registered" note.
- Randomness is `mulberry32(seedFor(params.seed, params.srcDeviceId, profileId))`;
  identical inputs produce identical flows.
- Flow ids are `<deviceId>:<stepId>:<i>`; source ports walk
  `baseSrcPort + (i % 64)`; jitter is bounded to `±jitterMs`.
- `target` strings are resolved by the caller through `resolve`:
  `TrafficPage.resolveTarget` matches an exact device id first, then
  `guest-local` (first other guest IoT device), then name-pattern fallbacks
  (`vendor-cloud` → `/vendor|cloud/i`, `c2` → `/c2|command/i`,
  `dns-server` → `/dns|resolver/i`, `ntp-pool` → `/ntp|time/i`).
  Unresolved targets skip the step.
- `STATE_PROFILE_OVERRIDE` maps `noisy` → `noisy-chatter` and
  `misconfigured` → `misconfig-retry`; a compromised device keeps its base
  profile and gets `COMPROMISE_PLAN` flows appended.
- `src/engine/traffic.test.ts` covers determinism, jitter bounds, unresolved
  targets, unknown profiles, and state overrides. Extend it when adding a
  profile with special semantics.

## 7. Change checklist

| Change | File(s) | Must update |
| --- | --- | --- |
| Archetype | `src/registry/devices.ts` | `devices.test.ts` invariants hold (run tests) |
| Board | `src/registry/profiles.ts` | HardwarePage auto-includes; recommended registry test |
| Adapter | `src/registry/profiles.ts` | HardwarePage auto-includes; recommended registry test |
| Firmware profile | `profiles.ts` union + record, `store.tsx`, `experiment.ts`, `validation.ts` | dialect mapping branches; `applyFirmware` notice flows |
| Attack scenario | `src/engine/attacks.ts` | `attacks.test.ts` invariants; prerequisites early-return |
| Traffic profile | `src/engine/traffic.ts` | any archetype referencing it; `traffic.test.ts` |
| New page (UI) | `src/app/pages/*`, `src/app/App.tsx` | `PAGES` entry + smoke test page list |
