# Warden32 — Architecture

System overview for contributors. Describes the code as it exists at engine
version `0.3.0` (`ENGINE_VERSION`, `src/storage/project.ts`). Nothing here is
aspirational — if code disagrees with this document, the code is right.

Warden32 is an offline, deterministic browser simulation of an ESP32 firewall /
NAT router (ESP32-WROOM-32D + LAN8720 uplink, SoftAP guest network). It runs
entirely in the browser: no backend, no accounts, no network I/O. The
simulation core is pure TypeScript and runs headless in Node for tests and
experiments (`src/engine/*.test.ts`, Vitest node environment).

## 1. Layers

| Layer | Path | Role |
| --- | --- | --- |
| Simulation core | `src/engine/` | Pure, UI-independent, I/O-free model: pipeline, clock, events, routing, firewall dialects, policy, NAT/NAPT, conntrack, visibility, resources, attacks, experiments, calibration |
| Registry and data | `src/registry/`, `src/data/` | Versioned data entries: firmware profiles, hardware boards, Ethernet adapters, device archetypes, the default sample lab |
| Storage and export | `src/storage/` | `.warden32` single-file projects (schema + checksum + validation), localStorage autosave, CSV/JSON/Markdown exports |
| UI shell | `src/app/` | React pages, topology canvas, inspector, panes; renders engine outputs, never makes networking decisions |

Dependency rule: `app → (engine, registry, storage)`, and `engine` imports from
`registry` only for profile data (firmware ACL dialect, uplink type,
management channels) and from `data` only in tests/experiments. `engine` never
imports React, DOM, storage, or network APIs.

## 2. Architecture diagram

```
 ┌─────────────────────────────── UI layer (React) ────────────────────────────────┐
 │  App.tsx        shell: title bar · activity rail · explorer · center · panes    │
 │  store.tsx      project state · SimEngine instance · FlowResult[] · notices     │
 │  pages/*        14 pages (§15): overview, devices, activity, traffic, …        │
 │  components/*   TopologyCanvas (hand-rolled SVG) · Inspector                    │
 └──────────────┬────────────────────────────────────────────────▲─────────────────┘
                │ actions: run battery, run attack, edit project, │ FlowResult[],
                │ switch firmware, save/open, quarantine, …       │ SimEvent stream
 ┌──────────────▼────────────────────────────────────────────────┴─────────────────┐
 │  SimEngine — src/engine/engine.ts (stateful facade)                             │
 │    submitFlow(flow) → classify → checks → branch → policy → NAPT → route →      │
 │                       verdict (FlowResult + collected SimEvents)                │
 │    advanceTo(ms)    → SimClock + timer/tx drain + conntrack expiry              │
 │    counters · ruleHits · connections · guestNapt/upstreamNapt · resources       │
 └───┬──────────────┬──────────────────┬──────────────────┬────────────────────────┘
     │              │                  │                  │
 ┌───▼──────────┐ ┌─▼──────────────┐ ┌─▼───────────────┐ ┌▼─────────────────────┐
 │ model/types  │ │ pure modules   │ │ stateful tables │ │ registry + data      │
 │ ProjectModel │ │ routing        │ │ SimClock        │ │ FIRMWARE_PROFILES    │
 │ DeviceModel  │ │ firewall       │ │ EventLog        │ │ HARDWARE_PROFILES    │
 │ RuleModel    │ │ policy         │ │ ConnTrackTable  │ │ ETHERNET_ADAPTERS    │
 │ Flow/Result  │ │ visibility     │ │ NaptTable ×2    │ │ DEVICE_ARCHETYPES    │
 │ SimEvent     │ │ address · rng  │ │ ResourceTracker │ │ sampleLab            │
 └──────────────┘ └────────────────┘ │ IncidentLog     │ └──────────────────────┘
                                     └─────────────────┘
 ┌───────────────────────── storage (browser, no server) ──────────────────────────┐
 │  project.ts: warden32.project v1 · FNV-1a checksum · validate/parse/serialize   │
 │  persistence.ts: localStorage autosave + prefs · download/read text             │
 │  exports.ts: experiment JSON / CSV / Markdown                                   │
 └─────────────────────────────────────────────────────────────────────────────────┘
```

## 3. Module map

### Engine core — `src/engine/`

| File | Responsibility |
| --- | --- |
| `engine.ts` | `SimEngine`: stateful facade. `submitFlow` executes the full pipeline; `advanceTo` advances clock/resources and expires conntrack; device controls (`setQuarantine`, `setLinkState`, `setDeviceOnline`, `addBlockRule`); counters, rule hits, resource snapshot, NAPT accessors |
| `model.ts` | Project domain model: `ProjectModel`, `DeviceModel`, `InterfaceModel`, `ZoneModel`, `RouteModel`, `RuleModel`, `AclEntryModel`, `StockAclModel`, `FirewallModel`/`FirewallDialect`, `PortForwardModel`, `ResourceConfig`, `SimConfig` |
| `types.ts` | Shared value types: `Flow`, `FlowResult`, `NatHop`, `SimEvent`, `EventCategory`, `EventSeverity`, `FlowVerdict`, `ConnState`, `Scope`, `EnforcementPoint`, `Protocol`, `Provenance` |
| `clock.ts` | `SimClock`: virtual milliseconds, timer queue ordered by `(atMs, insertion seq)`, `schedule`/`scheduleAt`/`cancel`/`advanceTo`; refuses to move backwards |
| `events.ts` | `EventLog`: append-only, capped at 20000 entries, monotonic ids, cursor-based reads (`since`, `lastId`), category filter, live subscribers |
| `routing.ts` | Longest-prefix route lookup over enabled routes on up interfaces; connected-route derivation (`connectedRouteFor`); disabled/down/unknown-interface reasons |
| `firewall.ts` | `matchRule` (protocol, zones, interfaces, ports, conn state, src/dst as device id, IP, or CIDR), `evaluateStatefulRules` (first match + default policy), `evaluateStockAclList`, `parseStockAclLine` / `formatStockAclEntry` |
| `policy.ts` | `evaluateDeviceEgress`: per-device egress allowlist (`vendor-only`, `allow-all`, `block-all`) |
| `nat.ts` | `NaptTable`: per-flow source translation, deterministic port allocation from 49152–65535, capacity with `NatTableFullError`, reverse lookup |
| `conntrack.ts` | `ConnTrackTable`: 5-tuple flow identity, NEW→ESTABLISHED confirmation, timeouts, expiry, capacity |
| `visibility.ts` | `classifyFlow`: scope (`internet-routed`, `lan-routed`, `guest-L2-peer`, `wifi-management`, `esp32-local`), `visibleToFirewall`, `enforcementPoint` |
| `address.ts` | IPv4 parse/format, prefix math, `inSubnet`, private-range and RFC 5737 documentation-range helpers |
| `rng.ts` | `mulberry32` seeded PRNG |
| `resources.ts` | `ResourceTracker`: CPU/airtime 1 s windows, TX queue depth with drain, RAM budget snapshot; constants in `calibrationDefaults.ts` |
| `traffic.ts` | Ten traffic profiles and seeded generators: `generateProfileFlows`, `generateCompromiseFlows`, `generateDeviceFlows`; per-device stream seeds via FNV-1a (`seedFor`) |
| `attacks.ts` | Attack scenario catalog (data, each with `modeled` flag and provenance) and `runScenario`; unmodeled scenarios are listed but produce no flows |
| `incident.ts` | `IncidentLog`: incidents with severity/status, actions, evidence event ids |
| `experiment.ts` | Headless experiment runner: clones the project, applies firmware/policy/seed, replays flows through a fresh `SimEngine`, aggregates verdicts, costs, rule hits, resource snapshot; comparison and metric rows |
| `calibration.ts`, `calibrationDefaults.ts` | Measurement-import calibration profile resolved over engine default constants (CPU/airtime/RAM base) |
| `failures.ts` | Failure injection presets (WAN/guest link down, RAM, TX queue, NAPT capacity, DNS offline); CPU pressure is deliberately not injectable |
| `validation.ts` | Hardware validation checklist and measured-vs-expected evaluation with tolerance bands |

### Registry and data

| File | Responsibility |
| --- | --- |
| `src/registry/profiles.ts` | `FIRMWARE_PROFILES` (stock-eth, stock-wifi, softap-sta, target-v1), `HARDWARE_PROFILES` (8 boards), `ETHERNET_ADAPTERS` (8 adapters) — plain data with provenance tags |
| `src/registry/devices.ts` | `DEVICE_ARCHETYPES`: 23 entries (15 IoT + 8 infrastructure/external) with services, vendor endpoints, traffic profile, egress policy, provenance |
| `src/data/sampleLab.ts` | `buildSampleProject()` (default topology: Internet → home router → ESP32 → three guest IoT devices) and `buildSampleFlows()` (7-flow battery) |

### Storage

| File | Responsibility |
| --- | --- |
| `src/storage/project.ts` | Project file contract: `schema: "warden32.project"`, `schemaVersion: 1`, `ENGINE_VERSION`, canonical-JSON FNV-1a checksum, `serializeProject`, `parseProject` (rejects newer schemas and checksum mismatches), `validateProject` (addresses, pools, duplicates, references, port ranges) |
| `src/storage/persistence.ts` | localStorage autosave and prefs, `downloadText`, `readTextFile`, `slugify`; all storage failures degrade silently |
| `src/storage/exports.ts` | Experiment exports: JSON bundle, CSV events, Markdown report with traceable metric rows |

### UI shell — `src/app/`

| File | Responsibility |
| --- | --- |
| `store.tsx` | `AppStoreProvider` / `useApp`: holds the `ProjectModel`, a memoized `SimEngine` rebuilt on every project edit (project is deep-cloned into the engine), `FlowResult[]`, selection, page/tab state, notices; wires save/open/drag-drop to the storage layer |
| `App.tsx` | IDE shell per §15.1: title bar with firmware selector and `run battery`, activity rail, explorer tree, center page, right pane stack `[1] inspect … [5] attacks`, status bar (firmware, baseline, dialect, seed, nodes, adapter, engine version) |
| `ui.tsx` | Shared primitives (`Pane`, `Chip`, `KV`, `Empty`), verdict/category tone maps, label→tone heuristic |
| `components/TopologyCanvas.tsx` | Hand-rolled SVG topology with a deterministic fixed layout (decision: M1/M2 log — React Flow deferred to the interactive-editing milestone) |
| `components/Inspector.tsx` | Selected-device pane: identity, addressing with simulation-range notes, egress policy, services, vendor endpoints |
| `pages/*.tsx` | Overview, Traffic, Rules, Attacks, Incident, Resources, Experiments, Compare, Hardware, Registry, Docs; the topology page is rendered by `TopologyCanvas` |
| `main.tsx`, `index.html`, `src/styles.css` | Entry point, host document, theme tokens copied from design kit #19 |

## 4. Data flow

1. A `ProjectModel` enters the UI either from `buildSampleProject()`, a parsed
   `.warden32` file, or an autosave restored from localStorage
   (`store.tsx`).
2. Every project edit produces a new immutable snapshot (`setProject` clones);
   the store then constructs `new SimEngine(clone(project))`. The engine is the
   only component allowed to decide outcomes; the UI only renders
   `FlowResult` objects and `SimEvent` records.
3. Flow sources generate `Flow` values: the sample battery
   (`buildSampleFlows`), attack scenarios (`runScenario`), or the seeded traffic
   generators (`generateDeviceFlows`). Each flow is submitted with
   `engine.submitFlow(flow)` and returns one `FlowResult`; the engine
   simultaneously appends `SimEvent`s to `engine.events`.
4. Results accumulate in the store; the right-hand panes read
   `result.events`, `engine.events.all` (console), `engine.ruleHitsFor`,
   `engine.connections`, and `engine.resourceSnapshot()`.
5. Exports read the same objects: project files from `serializeProject`,
   experiment bundles from `runExperiment` + `storage/exports.ts`.
6. Time only moves through `engine.advanceTo(ms)` (used by attack replay,
   experiments, and traffic batches) — never through wall-clock reads.

## 5. Determinism strategy

| Mechanism | Implementation |
| --- | --- |
| Virtual clock | `SimClock` holds simulated milliseconds; every engine-emitted timestamp (`SimEvent.ts`) and conntrack/rule-window comparison comes from `clock.now`. The engine never reads `Date.now()` |
| Timer order | Timers fire by earliest `atMs`, tie-broken by insertion sequence (`clock.ts` `nextDue`) |
| Seeded randomness | All randomness is `mulberry32` (`rng.ts`). Traffic streams seed from `seedFor(project.sim.seed, deviceId, profileId)` so per-device streams are stable and independent; compromise traffic seeds separately |
| Deterministic NAT | `NaptTable.allocatePort` scans upward from 49152 and wraps at 65535; same submission order ⇒ same translated ports (asserted in `engine.test.ts`) |
| Stable identities | `EventLog` ids increase monotonically from 1 and are never reused; `ConnTrackTable` ids likewise |
| Snapshot inputs | The UI passes a deep clone of the project into the engine; engine-side mutations (`quarantine`, inserted block rules, link state) cannot leak back into unsaved UI state until the user edits it |
| Same seed ⇒ same results | Covered by the reproducibility test in `engine.test.ts` (verdicts, reasons, NAT chain, event messages equal across two engines) |

One deliberate exception: `serializeProject` stamps `exportedAt` with the real
wall clock. This is file metadata only and never participates in simulation.

## 6. Event log design

`SimEvent` (`types.ts`): `{ id, ts, category, severity, message, flowId?, packetId?, deviceId?, data?, provenance }`.

- `ts` is engine time in milliseconds.
- `category` is the `EventCategory` union in `types.ts`:
  `system`, `pipeline`, `firewall`, `nat`, `conntrack`, `routing`, `resource`,
  `traffic`, `attack`, `wifi`, `incident`, `metrics`. The pipeline currently
  emits from `system`, `pipeline`, `firewall`, `nat`, `conntrack`, `routing`,
  `resource`, `attack`, `wifi`, and `incident`; `traffic` and `metrics` are
  defined but not currently emitted by any engine module.
- `severity` is `info | ok | warn | error`.
- `provenance` is required on every event: `measured | datasheet | paper |
  estimate | assumption`.
- `EventLog` is capped at 20000 entries (oldest trimmed), exposes `all`,
  `count`, `lastId`, `since(id)`, `byCategory`, and `subscribe`. `since(id)`
  gives callers a stable cursor: `advanceTo` records `lastId` before advancing
  and returns the events produced during the advance.
- Every `FlowResult` carries the events collected during its evaluation
  (`FlowResult.events`); `SimEngine.finalize` appends the closing
  `pipeline` event `ALLOWED|DENIED|DROPPED|NOT-ENFORCEABLE — <reason>`.
- The console pane renders the newest 250 events newest-first with category,
  timestamp, message, and provenance chips.

## 7. Pure versus stateful

Pure (no hidden state; directly unit-testable):

- `address.ts`, `routing.ts` (`lookupRoute`, `connectedRouteFor`),
  `firewall.ts` (match/evaluate/parse/format), `policy.ts`,
  `visibility.ts`, `calibration.ts` (`resolveCalibration`), `experiment.ts`
  comparison and metric helpers, `traffic.ts` generators (pure given a seed).

Stateful (hold mutable simulation state for the lifetime of one engine):

- `SimEngine` (counters, rule hits, rate windows, references to the working
  project), `SimClock`, `EventLog`, `ConnTrackTable`, `NaptTable`,
  `ResourceTracker`, `IncidentLog`.

Boundary rules:

- The UI never computes verdicts, routes, or NAT translations; it renders
  `FlowResult`/`SimEvent` data (decision log: M1).
- Stateful mutations that change behavior are explicit engine methods
  (`setQuarantine`, `addBlockRule`, `setLinkState`, `setDeviceOnline`) or
  project edits that rebuild the engine. There is no hidden global state.
- The engine performs no I/O of any kind.

## 8. Honesty constraints encoded in the architecture

- Traffic that never reaches lwIP (client-to-client relay, 802.11 management)
  exits the pipeline as `not-enforceable` with airtime-only cost
  (`visibility.ts`, `engine.ts`). Verified fact: ESP-IDF issue #13781 closed
  `not_planned` (measured).
- Hypothetical firmware (`target-v1`) carries the `not implemented on
  hardware` label on every result (decision log; `FIRMWARE_PROFILES`).
- Numeric constants are provenance-tagged: SRAM 520 KB for ESP32-WROOM-32D
  (datasheet), LAN8720 RMII 100 Mbps (datasheet), CPU/airtime cost units, RAM
  per-connection/NAPT/buffer costs, and the 2048-entry NAPT capacity are
  `estimate` until hardware calibration is imported (`docs/DECISIONS.md`).

## 9. Testing and CI

- Vitest tests run headless in Node next to the modules: `engine.test.ts`,
  `firewall.test.ts`, `conntrack.test.ts`, `nat.test.ts`, `routing.test.ts`,
  `clock.test.ts`, `traffic.test.ts`, `attacks.test.ts`, `experiment.test.ts`,
  `incident.test.ts`, `resources.test.ts`, `calibration.test.ts`,
  `devices.test.ts`, `project.test.ts`, and the app smoke test.
- `.github/workflows/ci.yml`: `npm ci → npm run typecheck → npm test →
  npm run build` on push to `main` and on pull requests.

## 10. Related documents

- `docs/PIPELINE.md` — exact stage order of `SimEngine.submitFlow`.
- `docs/FIREWALL.md` — dialects, rule model, ACL parsing, quarantine,
  port-forward interaction.
- `docs/DECISIONS.md` — implementation decision log this document is aligned
  with.
