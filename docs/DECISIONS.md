# Implementation decisions

- 2026-10-18 · M1 · Topology renderer = hand-rolled SVG (mirrors final design
  kit #19 exactly; full styling control, tiny bundle). React Flow stays the §5
  plan for interactive editing; revisit at M2 when nodes become draggable.
- 2026-10-18 · M1 · Styling = plain CSS with §15.1 tokens (no Tailwind yet).
  The tokens ARE the product; Tailwind lands in M2 with the full pane system.
  Token values live in `src/styles.css` and are copied verbatim from the kit.
- 2026-10-18 · M1 · Engine = pure TypeScript, deterministic, no I/O; tests run
  headless in Vitest (node environment). The UI never makes networking
  decisions (§6).
- 2026-10-18 · M1 · `ui-demo.html` remains the design kit; the app palette is
  copied from kit #19 so the two never drift.
- 2026-10-18 · M1 · Toolchain bumped to vite 8.3.4 / vitest 5.0.5 /
  @vitejs/plugin-react 6.1.2 after `npm audit` flagged dev-only advisories in
  the vite 5 / vitest 2 line (esbuild dev-server, tinypool RCE). Tests and
  build verified green after the bump; lockfile committed. Audit: 0 findings.
- 2026-10-18 · M1 · Engine pipeline implemented per §9 as a single
  `LabEngine.evaluate()` with ordered stages (classify → local/inbound/
  outbound branch → conntrack → policy dialect → double NAT → route →
  verdict); every result carries scope/visibility, NAT chain, labels and a
  structured event stream. CPU/airtime cost constants are `estimate`
  provenance until the resource model (§14) lands in M4.
- 2026-10-18 · M2 · Engine core landed: deterministic SimClock (tie-break by
  insertion order), EventLog (capped, cursor-stable), routing table derived
  from up interfaces at runtime + static/default routes from the project,
  firewalls as ordered first-match rule lists with strict dialects,
  `.warden32` single-file project (schema `warden32.project`, FNV-1a
  checksum, `skipChecksum` recovery) + autosave. `sim.ENGINE_VERSION` = 0.2.0.
- 2026-10-18 · M2 · UI stays hand-rolled SVG for M2 (React Flow revisit at
  interactive-editing milestone); save/open/drag-drop wired to storage layer.
- 2026-10-18 · M3 · Connection tracking is its own module (`conntrack.ts`)
  with explicit timeouts (TCP NEW 10s, established 300s, UDP 30s, DNAT 120s —
  `estimate` provenance, standard values). Established flows bypass rule
  evaluation — matches how conntrack is used in production NAT firewalls.
  The table has a capacity and drops new flows when full (honest resource
  behaviour, feeds §14).
- 2026-10-18 · M3 · Inbound path implements the full double-NAT DNAT chain:
  upstream home router forward → ESP32 forward → internal device. A missing
  forward on either router drops with a boundary-specific reason. A forward
  implies allow unless an explicit rule blocks it; every enabled forward adds
  an exposure label (spec §7 security-implication flag).
- 2026-10-18 · M3 · Ingress source check drops spoofed source addresses only
  when the packet is visible to lwIP; L2-relayed frames stay "not
  enforceable" — consistent with the Wi-Fi driver reality §3.
- 2026-10-18 · M3 · Per-rule `rateLimitPerSec` is a fixed 1s window token
  counter kept in the engine (deterministic, advances with the SimClock only).
- 2026-10-18 · M4 · Device library lives in `src/registry/devices.ts` as data
  (22 archetypes — 15 IoT + infrastructure/external); traffic shapes in
  `src/engine/traffic.ts` (10 profiles) tagged `paper` where they follow the
  IoTDI 2020 calibration, `assumption` for demo endpoints. Device state is
  derived: `compromised` flag + `behaviorState` (normal/noisy/misconfigured);
  compromise only changes generated traffic, never the device list (§11).
- 2026-10-18 · M5 · Attack catalog is data (`src/engine/attacks.ts`) with a
  `modeled` flag; unmodeled radio-layer attacks (deauth, DHCP starvation) are
  listed with honest "not modeled" descriptions instead of fake results.
  Incident response = quarantine (engine-level denial + labels explaining the
  stock firmware cannot isolate a client) and block rules (stateful dialect
  only; stock ACLs cannot match a source device — explained in the response).
- 2026-10-18 · M6 · Resource model: RAM/heap budget from board `ramKb`
  (datasheet) plus per-connection/NAPT/buffer costs (`estimate`), tx queue
  with burst overflow drops, CPU load as a 1s window output that labels
  saturation without dropping (honest: real firmware adds latency, not loss).
  Failure injections are presets (`src/engine/failures.ts`); CPU pressure is
  deliberately not injectable. NAPT/conntrack capacity bind at engine start.

## M7 — Experiments & exports

- `engine/experiment.ts`: `ExperimentConfig` (typed `policyBaseline`), `configFromProject` (project → config, no mutation), `runExperiment` clones the project before constructing a SimEngine, so runs can never mutate the live lab; `runExperimentSuite` runs configs sequentially; `compareResults` emits per-metric deltas with provenance; `defaultComparisonConfigs` = stock-eth, stock-wifi, target-v1 (plus P-D as a label-only future baseline); `metricRows` keeps traceability (metric → source flow set → derivation).
- `storage/exports.ts`: `experimentToJson`, `experimentToCsv` (19 columns), `experimentToMarkdown` (includes a provenance table and the engine version), `experimentFileName`. All artifacts carry `ENGINE_VERSION` (0.2.0).
- Decision: experiments clone projects instead of snapshotting engine state — the engine is cheap to reconstruct and the clone guarantees determinism equality with a fresh load.

## M8 — Calibration & validation

- `engine/calibration.ts`: `CalibrationProfile` (cpuCostPerPacket, airtime fractions, ramBaseKb), `DEFAULT_CALIBRATION`, `resolveCalibration` with per-metric fallbacks, `serializeCalibration`/`parseCalibration` for the `warden32.calibration` v1 format with per-metric validation. `engine/calibrationDefaults.ts` holds the constants (moved out of the engine).
- `SimEngine` now takes an optional calibration profile; resolved values drive routed CPU cost, routed/L2 airtime and the `ResourceTracker` RAM base. Defaults are tagged `assumption` — they are honest placeholders until hardware measurements replace them.
- `engine/validation.ts`: `buildValidationChecklist` (real measurable procedures), `recordMeasurement`, `evaluateValidation` (ok/warn/fail/no-data against target+tolerance), `validationToMarkdown`. The module never invents `measured` provenance; no-data stays no-data.
- Decision: calibration import validates and displays, but does not silently rewire the running engine — swapping constants requires the explicit validation workflow so no imported file can masquerade as measured truth.

## M9 — UI shell, pages, docs, CI

- IDE shell per design kit #19: activity bar (12 pages), explorer (zones → devices with router/compromised/quarantine marks), center tabs + scrollable page body, right pane `[1] inspect [2] rules.fw [3] packets.log [4] console [5] attacks`, accent statusbar (firmware, baseline, dialect, seed, nodes, adapter, engine version).
- `src/app/store.tsx` (AppStoreProvider: project/engine/results/selection/notice + all actions incl. drag-drop import and autosave) and `src/app/ui.tsx` (Pane/Chip/KV/Empty primitives + verdict/category/label tone helpers).
- 12 pages in `src/app/pages/`: overview, topology, traffic, rules, attacks, incident, resources, experiments, compare, hardware, registry, docs — all honesty-law compliant (provenance chips, verbatim engine refusals, "not modeled" labels).
- `src/app/app.smoke.test.tsx`: SSR smoke test rendering the shell + all 12 pages (react-dom/server, stubbed localStorage).
- Docs: full `docs/` set (ARCHITECTURE, PIPELINE, FIREWALL, LIMITATIONS, VERIFIED-FACTS, CLAIMS-MATRIX, FIRMWARE-MAPPING, HARDWARE-CHECKLIST, STYLE, EXTENDING, TEST-PLAN, REPRODUCIBILITY, EXPERIMENT-METHODOLOGY, TROUBLESHOOTING) + CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG, LICENSE (Apache-2.0), GitHub CI/templates.
- Post-audit fixes from the doc agents' discrepancy reports: upstream NAPT table now honors `resources.naptCapacity`; non-IPv4 esp32-local event message is dialect-aware (was stock-only wording under target); stock ACL port-restricted entries no longer match portless flows; `parseProject` rejects unknown board/adapter/firmware ids with clear errors instead of crashing the engine; `store.applyFirmware` ternary cleanup; OverviewPage "5–15 Mbps" fact tagged `estimate` (was `measured`, inconsistent with validation.ts).
- Registry correction: M4 shipped **23** archetypes (17 iot + 3 infrastructure + 3 external), not 22 as first written above.
- Verified: 15 test files / 122 tests green; typecheck clean; production build green; SSR smoke covers every page.

## M9 addendum — topology brought in line with design kit #19

- Topology redrawn to the ui-demo.html #19 canvas: WARDEN32 BOARD frame (dashed) wrapping the uplink module + ESP32 node (`hot` accent), RMII/SPI bus label, WAN column with J/W reference designators, HOME ROUTER (J2), guest column (D1..Dn) with dashed Wi-Fi links and the "AP relay · unfiltered" bypass arc, PCB pin stubs, ref designators.
- Floating chrome per demo: pill toolbar (uplink module select + hint), zoombar (＋ − ↺, 0.5–2.0 zoom), device palette (uplink modules + boards, click switches `sim.adapterId`/`sim.boardId` — same fields the Hardware page edits, so engine rebuild semantics are unchanged).
- Verdict markers (ok/drop/warn dot + ✕) render only from real engine results — no ambient animation (honesty law), one-shot pop on new runs.
- WAN column compressed (48px pitch) so the floating palette never hides nodes; palette shows all registry adapters and boards.
- Preview screenshots kept at `docs/screenshots/` (topology, overview) from headless Firefox at 1440×900.

## M9 addendum — draggable topology (free move)

- Every node on the topology board is freely draggable: WAN column, home router, uplink module, ESP32 board, guest devices. Selection happens on pointerdown; drag uses pointer capture on the SVG root, so it keeps working while zoomed (inverse `getScreenCTM()` maps client → viewBox coords).
- All connectors are geometry-derived at render time: WAN fan-in, router→module→ESP32 hops, dashed Wi-Fi curves, the "AP relay · unfiltered" bypass arc (first↔last guest right edges), PCB pins, ref designators, and the dashed board frame (bounding box around module + ESP32).
- Positions are stored as *overrides* keyed by device id (plus fixed `module` key), persisted per project id in `localStorage` (`warden32.topo.layout.v1.<projectId>`, validated on load); draggable coordinates are clamped to the 1020×560 viewBox.
- `⌗` button in the zoombar resets the layout (clears overrides + stored copy). The float toolbar hints "drag to move · click to inspect".
- No animation on drag — positions are pure view state; they do not touch the
  project schema, engine, or determinism (honesty law: view-only extensions
  keep the paper/engine boundary intact).

## M10 — custom IoT devices, activity simulation, bandwidth accounting, user guide

- Schema (additive): `DeviceModel.demandMbps` / `capMbps` (optional,
  nullable) and `SimConfig.uplinkMbps` (optional); validation `demandMbps >= 0`,
  `capMbps > 0`, `uplinkMbps > 0 <= 100000`. Schema version stays 1 — older
  files remain valid and canonical serialization drops `undefined`.
  `ENGINE_VERSION` bumped `0.2.0` → `0.3.0`.
- `registry/activity.ts` is keyed by *traffic profile id* (not archetype), so
  arbitrary device profiles resolve or fall back to `generic-embedded`.
  Compromised sets per profile: C2 beacon (TCP 8443), DNS tunnel (UDP 53),
  LAN scan (TCP 445), exfiltration (TCP 443).
- Decision — sampling honesty: a generated flow is a *sampled
  representation* (`Flow.sampleOf` raw events, `Flow.bytes` summed volume).
  Byte totals are exact against configured demand; flow counts are samples
  (cap `DEFAULT_MAX_PER_ACTIVITY = 60`). The report states this instead of
  fabricating burst structure; peak tracks average by construction.
- Decision — caps stay `capEnforceable: false` on every dialect: the stock
  4-list ACL has no rate/fairness concept, and even `target-v1` lacks Mbps
  shaping. Caps are configuration targets; the UI shows `demand above cap`
  and the report carries a dialect-aware `capNote`. Demand is never silently
  clamped.
- Decision — no queueing model: `sim.uplinkMbps` drives capacity accounting
  (saturation, over-subscription) against both the link rate and the
  5–15 Mbps routed-throughput `estimate`; over-subscription is reported
  rather than a fabricated queue.
- `storage/deviceOps.ts`: deterministic allocation (next free `10.x.0.x`
  skipping devices/interfaces/DHCP pool; MACs `3c:71:bf:…`); removal refuses
  router/gateway/internet and strips port forwards + rules referencing the
  device.
- Clock fix: per-device sequential submission broke `SimClock` monotonicity
  ("clock cannot move backwards"); activity flows are planned globally and
  sorted by timestamp before `advanceTo`/`submitFlow`.
- Deep link `?run=activity[-normal|-compromised]`: the run executes in the
  store's lazy state initializer (before first paint) — a real deterministic
  run, documented, used for reproducible screenshots; not a hidden backdoor.
- Docs: `docs/USER-GUIDE.md` (canonical source) plus a zero-dependency
  `tools/make-pdf.mjs` (Courier layout, WinAnsi encoding, real xref table)
  producing `docs/Warden32-User-Guide.pdf`; regenerate with
  `npm run make-pdf` (reads `ENGINE_VERSION` for the footer).

## Repository preparation — relicense to MIT, initial git history

- 2026-10-19 · Relicensed from Apache-2.0 (the build brief recommended it and
  asked for confirmation before first release) to MIT per owner decision.
  `LICENSE`, `package.json`, the `package-lock.json` root entry, README and
  USER-GUIDE updated; historical planning documents keep their original
  wording.
- The original build brief (`MASTER-BUILD-PROMPT.md`) is excluded from the
  public repository (`.gitignore`); references to it in README, ARCHITECTURE,
  VERIFIED-FACTS and CONTRIBUTING were reworded to stand alone.
- Initial git history: a single initial commit on `main` (no prior history
  existed).
