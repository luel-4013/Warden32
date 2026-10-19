# Warden32 test plan

Status at the time of writing: **17 files, 144 tests, all passing** in ~0.7 s
(`npx vitest run`). The suite runs fully offline and makes no network calls.

## 1. How to run

| Command | Purpose |
| --- | --- |
| `npm test` | Alias for `npx vitest run` (via `package.json`). |
| `npx vitest` | Watch mode for local development. |
| `npx vitest run src/engine/engine.test.ts` | Run a single file. |
| `npx vitest run -t "double NAT"` | Run tests matching a name substring. |
| `npx vitest run --reporter=verbose` | Print every test name (used for the inventory below). |

Environment facts:

- Vitest 5.0.5 with default configuration — no `test` block in
  `vite.config.ts`, so the environment is `node` (no jsdom).
- React components are tested with `renderToString` from `react-dom/server`
  (`src/app/app.smoke.test.tsx`); there are no DOM-interaction tests.
- The smoke test installs an in-memory `localStorage` shim, because
  `src/app/store.tsx` reads `warden32.autosave.v1` and
  `warden32.prefs.v1` at module load.
- CI (`.github/workflows/ci.yml`) runs `npm ci` → `npm run typecheck` →
  `npm test` → `npm run build` on Node 22 (ubuntu-latest).

## 2. Test inventory

### `src/engine/engine.test.ts` — 22 tests (the end-to-end pipeline)

| Group | Tests | Protects |
| --- | --- | --- |
| visibility layer | marks guest-to-guest traffic as not enforceable (Wi-Fi driver relay); passes non-IPv4 unfiltered through the stock IPv4-only ACL | The single most important honesty invariant: unseeable traffic is `not-enforceable`, never "blocked". |
| NAT boundary | drops unsolicited inbound traffic at the upstream NAT boundary; rewrites outbound source twice (double NAT) and stays deterministic | Upstream NAT is a modeled enforcement point, not a footnote. |
| stock management surface | allows guest clients to reach the ESP32 management surface by default; denies it under the target design and flags it as not implemented on hardware | Stock behavior is reachable-by-default; target behavior carries the hardware gap label. |
| egress policy | permits C2 traffic on stock (default allow) but denies it under target vendor-only; allows vendor traffic even under stateful default-deny | Device allowlist outranks the default policy. |
| routing | drops guest→trusted-LAN traffic (no route to the disabled logical zone); emits a structured event stream for an allowed flow | Route-level containment and event shape. |
| reproducibility | same seed and same flows produce identical results and rule hit counters | Deterministic replay. |
| connection tracking | established return traffic skips rules; repeated flow becomes established; full table drops new flows; expiry re-evaluates; INVALID states dropped only under stateful dialect | Conntrack integration and dialect differences. |
| DNAT port-forwarding | both hops chained; upstream-only; ESP32-only; return traffic after creation | Every partial-forward failure mode is asserted. |
| ingress source checks and rate limits | spoofed sources dropped at ingress; per-rule limits enforced and reset per window | Anti-spoofing and rate limiting. |

### `src/engine/attacks.test.ts` — 12 tests

Catalog invariants (unique ids, valid provenance, non-empty descriptions;
unmodeled scenarios build empty and stay honest) plus one behavioral test per
modeled scenario: inbound port scan dropped at the NAT boundary when no
forwards exist; RTSP forwarded only when both routers forward; guest-to-guest
lateral probe `not-enforceable`; ARP spoofing relayed by the Wi-Fi driver; C2
allowed on stock / denied under target; DNS tunneling stopped under target
only; vendor exfiltration succeeds on both (allowlist honesty); spoofed
source dropped; non-IP flood treated as unfilterable stock traffic; clock
advances with the scenario and stays deterministic.

### `src/engine/firewall.test.ts` — 12 tests

Stateful rule evaluation (first match wins, disabled rules skipped,
port/protocol/zone/interface matching, state restrictions, default-policy
fallback), stock ACL evaluation (match protocol/port/remote; default allow;
drop entry honored), and stock ACL line parsing/formatter round-trip
(document format, single ports, malformed input errors).

### `src/engine/traffic.test.ts` — 10 tests

Profile generation (identical seeds → identical flows; interval+jitter
spacing is monotonic; unresolved targets skipped; unknown profile → `[]`),
device states (compromised flag derivation; noisy/misconfigured overrides;
compromised keeps base profile and adds adversarial flows; healthy device has
none), and the compromise plan (deterministic, within the beacon window;
`seedFor` stable and input-sensitive).

### `src/engine/resources.test.ts` — 9 tests

Snapshot shape and estimate provenance; RAM override honored; tx-queue burst
drops and recovery after drain; RAM exhaustion refuses new connections; CPU
saturation flags without dropping (latency note); failure-injection ids are
unique and "not injectable" entries honest; uplink-down drops routed traffic;
DNS-dependent traffic dies with the resolver; NAPT capacity applies on the
next engine build.

### `src/engine/calibration.test.ts` — 8 tests

Profile round-trip; malformed documents rejected with explicit errors;
calibrated costs applied to flow results; RAM base adjusted; missing metrics
fall back to defaults; validation checklist honest `no-data` before
measurements; measurements classified by tolerance bands; Markdown report
export. (The hardware-validation module is tested here.)

### `src/engine/experiment.test.ts` — 8 tests

Runner determinism; base project not mutated; stock vs target policy
difference for C2; compare table with per-metric provenance and deltas;
metric rows carry provenance for every figure; JSON export includes the flow
timeline; CSV export has one row per flow plus header; Markdown export
contains the provenance table and verdict list.

### `src/engine/incident.test.ts` — 8 tests

Lifecycle open → contained → closed with actions; actions refused on closed
incidents; quarantine drops from and to the device with honest labels;
release restores flow; containment recorded in the log; block-rule insertion
under the stateful dialect; stock ACL explains why it cannot block a guest
source.

### `src/engine/activity.test.ts` — 11 tests

Deterministic planning (same seed → identical flows; different seeds differ);
generated flows stay inside the run window and respect the configured volume
(byte totals equal demand); per-device caps are reported, never silently
clamped; compromised devices target the C2/DNS/scan/exfil endpoints; offline
devices are skipped with a note; quarantined devices get dropped verdicts;
over-cap and over-subscription warnings appear; a full run is reproducible
and advances the engine clock monotonically.

### `src/storage/deviceOps.test.ts` — 9 tests

Archetype/zone validation; address allocation skips devices, interfaces and
the DHCP pool (first free after `.20` is `.150` in a CSR-style layout);
deterministic MAC sequence (`3c:71:bf:…`); removal refuses router/gateway/
internet devices; removing a device strips its port forwards and rules;
`isRemovableDevice` and default-demand resolution.

### `src/storage/project.test.ts` — 9 tests

Serialize → parse round-trip; checksum mismatch rejected; checksum-skip
recovery; unknown schema / newer version rejected without corrupting state;
address/reference/pool validation; duplicate device addresses warn; checksum
stable for identical content; plus the M10 field validation (negative
demand, non-positive cap, out-of-range uplink rejected).

### `src/engine/routing.test.ts` — 6 tests

Longest-prefix preference; default route fallback; down interfaces excluded
with a reason; interface-down candidates reported for static routes; empty
table → no match; disabled route removed from candidates.

### `src/engine/conntrack.test.ts` — 6 tests

NEW → ESTABLISHED with extended timeout; reverse-tuple matching; forward
entry reuse; expiry; capacity; clear-and-report.

### `src/registry/devices.test.ts` — 5 tests

At least 15 IoT archetypes; unique ids; traffic profile references exist;
vendor-only has endpoints; valid ports/provenance/notes.

### `src/engine/clock.test.ts` — 4 tests

Timer order with insertion-order tie-break; chained timers within one
advance; no firing beyond the target; cancel; determinism across identical
schedules.

### `src/engine/nat.test.ts` — 3 tests

Deterministic port allocation, mapping reuse, capacity enforcement; inbound
lookup by translated port; seeded RNG sequence stability.

### `src/app/app.smoke.test.tsx` — 2 tests

Shell renders with the default page (asserts `WARDEN32` and `EXPLORER` in
the HTML); every page component renders non-empty output. The enumeration
lists the 13 components under `src/app/pages/`. The navigation has 14 pages:
the `topology` page has no component file of its own — it is rendered by
`TopologyCanvas` inside the shell and is exercised by the shell test through
the default page.

## 3. What the suite deliberately asserts

The suite is written as behavioral assertions, not snapshots. Four themes
recur and should guide new tests:

1. **Honesty about enforcement.** Traffic the model cannot see is
   `not-enforceable`; hardware gaps carry the `not implemented on hardware`
   label; unmodelable attacks return `[]`. Tests fail if a change starts
   claiming enforcement that does not exist.
2. **Determinism.** Same seed, same flows, same numbers — asserted at the
   clock, RNG, traffic, engine, and experiment layers. Any new randomness
   must be seed-derived (`mulberry32`), never `Math.random`.
3. **Traceability.** Every figure carries provenance; exports include the
   provenance table and per-flow timeline.
4. **Failures are explicit.** Checksum mismatch, schema mismatch, malformed
   ACL lines, malformed calibration files, full tables, exhausted RAM — all
   have dedicated tests asserting the error path, not the happy path only.

## 4. Coverage gaps (known and intentional)

- **No jsdom/UI interaction tests.** Pages are render-only smoke tested;
  button handlers, filters, and drag-and-drop are verified manually. Adding
  jsdom and `@testing-library/react` is the natural next step; it is not in
  this build.
- **No registry tests for boards, adapters, or firmware profiles**
  (`HARDWARE_PROFILES`, `ETHERNET_ADAPTERS`, `FIRMWARE_PROFILES`). Engine
  tests cover firmware behavior indirectly; board and adapter id resolution
  is covered only through engine constructor paths. See
  `docs/EXTENDING.md` for the recommended shape of such tests.
- **No test for the app store wiring** (`applyFirmware` dialect mapping) —
  this mapping exists in `store.tsx` and `experiment.ts` and must be updated
  together; a unit test over the mapping would catch drift.
- **The sample battery** (`buildSampleFlows`, 7 flows) is exercised through
  page code and manual runs, not through a dedicated test.

## 5. Adding or changing tests

- Put engine-level tests next to the module as `<module>.test.ts`, following
  the existing pattern.
- Prefer constructing small `ProjectModel` objects in-test (see
  `engine.test.ts` helpers) over importing the sample project, unless the
  test is about the sample.
- When adding a UI page, add it to the list in `app.smoke.test.tsx`; the test
  intentionally enumerates pages instead of importing `PAGES`, so a page
  added only to `App.tsx` still needs a smoke entry.
- Keep the full suite under a few seconds: it currently finishes in well
  under one second, which makes `npm test` usable as a pre-commit gate.
