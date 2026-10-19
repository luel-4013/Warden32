# Changelog

All notable changes to Warden32 are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project intends
to adopt [Semantic Versioning](https://semver.org/) once it is released.

The package version is `0.1.0` (see `package.json`); `.warden32` files record
the simulation engine version, currently `0.3.0`.

## [0.1.0] — Unreleased

Hardware validation is pending: no measured columns are populated anywhere in
the application. Every throughput, client-count, heap, CPU and airtime figure
is an `estimate` (or `datasheet`-backed budget) until a calibration profile
recorded on real hardware is imported (M8 workflow). Nothing in this release
is a hardware measurement, and simulated results must not be presented as one.

### M1 — Foundation: models, engine core, topology

#### Added

- Typed domain models for zones, interfaces, devices, routes, firewall rules,
  port forwards, resources and simulation settings, with provenance-tagged
  values (`src/engine/model.ts`, `src/engine/types.ts`).
- Initial simulation pipeline (`LabEngine.evaluate`) with ordered stages:
  classify → local/inbound/outbound branch → conntrack → policy dialect →
  double NAT → route → verdict. Every result carries scope, visibility, NAT
  chain, labels and structured events (`src/engine/engine.ts`).
- Hand-rolled SVG topology view and the deterministic sample lab project.

#### Changed

- Toolchain pinned to vite 8.3.4 / vitest 5.0.5 / @vitejs/plugin-react 6.1.2
  after `npm audit` flagged dev-only advisories in the previous line; audit
  clean after the bump.

### M2 — UI integration and engine plumbing

#### Added

- Deterministic `SimClock` (insertion-order tie-break) and a capped,
  cursor-stable event log; routing tables derived from up interfaces plus
  static/default routes; firewall rule lists as ordered first-match
  evaluation with strict per-dialect behaviour (stock-4list, stateful, none).
- Single-file `.warden32` project format: schema `warden32.project`, schema
  version 1, FNV-1a checksum with `skipChecksum` recovery, and autosave to
  local storage.
- UI integration: project new/open/save (download and drag-and-drop import),
  autosave restore, sample-battery replay in the top bar, and the event
  console. Switching firmware applies profile side effects (dialect, default
  policy, policy baseline) and rebuilds the engine.

### M3 — Connection tracking, double NAT, visibility checks

#### Added

- `conntrack.ts` with explicit timeouts (TCP NEW 10 s, established 300 s,
  closing 10 s, UDP 30 s, DNAT 120 s — `estimate`, standard values).
  Established flows bypass rule evaluation; the table enforces a capacity and
  drops new flows when full.
- Full double-NAT DNAT chain (upstream home router → ESP32 → internal
  device): a missing forward drops with a boundary-specific reason, and every
  enabled forward adds an exposure label.
- Ingress source check: spoofed sources are dropped only when the packet is
  visible to lwIP; L2-relayed frames stay `not enforceable` (verified Wi-Fi
  driver reality, spec §3).
- Per-rule `rateLimitPerSec` implemented as a fixed 1-second token counter
  that advances only with simulated time.
- Stateful dialect drops `INVALID` connection states before rule matching
  (`conntrack:invalid`).

### M4 — Device registry, traffic profiles, compromise model

#### Added

- Device archetypes as registry data (22 at this milestone: 15 IoT plus
  infrastructure/external) with services, management ports, egress policy,
  vendor endpoints and traffic profile — each with provenance.
- 10 traffic profiles (`src/engine/traffic.ts`), tagged `paper` where the
  shapes follow the IoTDI 2020 calibration and `assumption` for demo
  endpoints.
- Device behaviour states `normal | noisy | misconfigured` and the compromise
  model: a compromised device only changes its generated traffic, never the
  device list or the rules it obeys.

### M5 — Attack lab, incident response, DNS/NTP devices

#### Added

- 12 attack scenarios (`src/engine/attacks.ts`) across recon, initial access,
  lateral movement, C2, exfiltration, spoofing and DoS. 10 are modeled;
  Wi-Fi deauth and DHCP starvation are listed with `modeled: false` and
  honest explanations — they operate below the modelled stack and are not
  faked.
- Incident log with quarantine (engine-level denial plus labels explaining
  that the stock firmware cannot isolate a client) and stateful block rules
  (stock ACLs cannot match a source device, explained in the response).
- DNS and NTP infrastructure devices added to the registry.

### M6 — Resource model and failure injection

#### Added

- Resource model: RAM/heap budget from the board `ramKb` (datasheet) plus
  per-connection, NAPT and queued-buffer costs (`estimate`); TX queue with
  burst overflow drops; CPU load as a 1-second window that labels saturation
  without inventing packet loss; conntrack/NAPT capacities bind at engine
  start.
- 7 failure injections (`src/engine/failures.ts`): WAN link down, guest AP
  down, RAM pressure, TX queue pressure, NAPT exhaustion, upstream DNS outage
  and CPU saturation — the last one is deliberately not injectable and says
  so.
- Interface and device toggles, and route fail-fast (no route → dropped with
  a reason).

### M7 — Experiments and exports

#### Added

- Experiment configurations derived from a project (firmware, seed, policy
  baseline, duration) and a suite runner that replays the identical sample
  battery across configs.
- Policy baselines P-A (bare forwarding/NAT, softap_sta), P-B (stock
  stateless ACL, default-allow) and P-C (stateful default-deny + egress
  restriction, hypothetical); P-D is listed in the UI as hypothetical and
  `not implemented on hardware`.
- Comparison view across stock Ethernet, stock Wi-Fi and target design v1
  with per-metric deltas and provenance.
- Exports: experiment JSON, per-flow CSV and a Markdown report whose metrics
  table includes a provenance column and the note that `estimate` values
  await hardware calibration.

### M8 — Calibration profiles and validation checklist

#### Added

- Calibration profiles serialized as `.warden32.calibration`
  (`kind: warden32.calibration`, version 1). Parsing is strict: unknown
  metrics and invalid values are rejected. `resolveCalibration` falls back to
  engine defaults (`estimate`) until real measurements are imported.
- Validation checklist module (`src/engine/validation.ts`): LAN→WAN and
  WAN→LAN throughput, concurrent clients and idle free heap — each with an
  expected value, tolerance, provenance and status
  (`ok | warn | fail | no-data`), plus measurement recording and a Markdown
  export.
- Measured columns are empty by design: the lab never invents `measured`
  values.

### M9 — UI shell, pages, smoke tests, CI and repository files

#### Added

- IDE-style UI shell: activity bar, explorer tree with zones and devices,
  center pages, and 5 right-pane tabs (inspect, rules, packets, console,
  attacks).
- 12 pages: overview, topology, traffic, rules, attacks, incident, resources,
  experiments, compare, hardware, registry, docs.
- Server-side-render smoke tests that render the shell and every page
  headlessly.
- GitHub Actions CI (`.github/workflows/ci.yml`): Node 22, `npm ci` →
  typecheck → test → build on pushes to `main` and on pull requests.
- Repository files: Apache-2.0 LICENSE, CONTRIBUTING, CODE_OF_CONDUCT,
  SECURITY, issue templates (bug/feature) and a PR template carrying the
  honesty checklist.
- Test suite: 15 test files, 122 tests, all deterministic and passing.

### M10 — Device management, activity simulation, bandwidth accounting, user guide

#### Added

- Device management (`src/storage/deviceOps.ts` + `devices` page): add/remove
  IoT devices with archetype, zone, name and optional `demandMbps` /
  `capMbps`; deterministic address/MAC allocation that skips the DHCP pool;
  protected infrastructure devices; removal cleans port forwards and rules.
- Activity simulation (`src/registry/activity.ts`, `src/engine/activity.ts` +
  `activity` page): normal and compromised behaviour (C2 beaconing, DNS
  tunnelling, LAN scanning, exfiltration) sized from per-device demand,
  scheduled with seeded jitter and evaluated through the real pipeline.
  Reports include per-device accounting, per-activity breakdown and honesty
  notes; exports JSON/CSV/Markdown.
- Bandwidth accounting: `sim.uplinkMbps` (default 100 Mbps) plus total
  demand/saturation/over-subscription against both the link rate and the
  5–15 Mbps routed-throughput estimate. Per-device caps are reported as
  `not enforceable` targets — the simulated firmware has no rate shaping.
- Schema (additive): `DeviceModel.demandMbps` / `capMbps`, `SimConfig.uplinkMbps`,
  `Flow.bytes` / `Flow.sampleOf`; validation for all new fields. Engine
  version bumped `0.2.0` → `0.3.0`.
- `docs/USER-GUIDE.md` and a generated `docs/Warden32-User-Guide.pdf`
  (`npm run make-pdf`, zero-dependency `tools/make-pdf.mjs`).
- Activity deep links for reproducible screenshots/teaching:
  `?page=activity&run=activity[-normal|-compromised]`.

#### Fixed

- Activity runs now plan all flows globally and sort by timestamp before
  submission — the previous per-device sequential scheduling broke the
  monotonic simulation clock.

#### Changed

- Test suite: 17 files, 144 tests, all deterministic and passing.
- License changed from Apache-2.0 to MIT (owner decision). The original
  build brief is not included in the public repository; the historical
  planning documents keep their original wording.
