# Reproducibility

Warden32 is built so that a result produced on one machine can be re-produced
on another from the project file alone. This document states exactly what
that guarantee covers, where the environment still matters, and how to verify
it.

## 1. The determinism model

| Mechanism | Where | Effect |
| --- | --- | --- |
| Virtual clock (`SimClock`) | `src/engine/clock.ts` | All time is simulated; `advanceTo` throws `clock cannot move backwards`; timers fire in time order, ties broken by insertion order. No timer or expiry ever reads the wall clock. |
| Seeded PRNG (`mulberry32`) | `src/engine/rng.ts` | The only randomness in the engine. Storage, routing, and policy code have no randomness at all. |
| Seed derivation | `src/engine/traffic.ts` | Flow generation seeds from `(project seed, device id, profile id)` via `seedFor`; same inputs ⇒ identical flows (asserted). |
| Sorted replay | `src/engine/experiment.ts` | Flows are sorted by `timestampMs`, tie-broken by `id` before submission. |
| Canonical JSON + checksum | `src/storage/project.ts` | Object keys sorted, `undefined` dropped; checksum `fnv1a-<8 hex>` over the canonical project only. |
| Deterministic port allocation | `src/engine/nat.ts` | NAPT port walk and mapping reuse are seed/order driven; capacity is fixed (49152–65535). |

Exhaustive wall-clock audit: the only wall-clock read in the entire source
tree is `src/storage/project.ts:42` — `exportedAt: exportedAt ?? new
Date().toISOString()`. It is file metadata and is **excluded** from the
checksum, so two exports of the same project differ only in that field.
`params.timestampMs` values in exports come from the virtual clock.
`Math.random` does not appear anywhere in `src/` (the only mention is a
documentation sentence in `DocsPage`).

Interactively, the persistence layer writes exactly two things to browser
storage: the autosave (`warden32.autosave.v1`) and preferences
(`warden32.prefs.v1`, only `recentProjectName`). Neither influences engine
results.

## 2. Environment pinning

| Layer | Pinned by | Current value |
| --- | --- | --- |
| Node.js | `package.json` engines (via Vite) — `^20.19.0 || >=22.12.0`; CI uses Node 22 | test machine: v26.8.1 |
| Dependencies | `package-lock.json`, installed with `npm ci` in CI | `react`/`react-dom` ^18.3.1, `vite` ^8.3.4, `vitest` ^5.0.5, `typescript` ^5.6.3, `@vitejs/plugin-react` ^6.1.2 |
| Engine behavior | `ENGINE_VERSION = "0.3.0"` (`src/storage/project.ts`), embedded in project files and experiment exports | 0.3.0 |
| Tests | `npx vitest run` (default node environment) | 17 files, 144 tests, all passing |

No network access is required or performed at any point: install is
`npm ci` against the lockfile, and the app, tests, and design kit are fully
offline.

## 3. Project file format

A `.warden32` file is JSON with this envelope:

```json
{
  "schema": "warden32.project",
  "schemaVersion": 1,
  "engineVersion": "0.3.0",
  "checksum": "fnv1a-xxxxxxxx",
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "project": { }
}
```

`parseProject(text, options?)` behavior:

| Condition | Result |
| --- | --- |
| Not valid JSON / not an object | `ok: false`, error `not valid JSON: …` / `file is not a Warden32 project object`. |
| `schema` different from `warden32.project` | `ok: false`, `unknown schema "…" (expected warden32.project)`. |
| `schemaVersion` newer than 1 | `ok: false`, `schema version … is newer than this build supports (1)`. |
| Checksum mismatch (default) | `ok: false`, `checksum mismatch (file …, computed …) — file may be corrupted`. |
| Checksum mismatch with `{ skipChecksum: true }` | Accepted with warning `checksum verification skipped`. |
| Semantic validation | `validateProject` errors block; warnings (for example duplicate device addresses, public IP outside RFC 5737 ranges) are reported but do not block. |

Unknown extra fields inside `project` round-trip untouched (the object is
cloned and re-serialized as-is), which keeps forward compatibility for data
added by later builds.

The in-app open flow surfaces parse errors as `open failed: <errors joined by
"; ">`; successful opens report `opened "<name>"` plus a warning count when
applicable. Saves always write the current `ENGINE_VERSION`, so a file tells
you which engine produced it.

## 4. Reproducing a run, step by step

```bash
git clone <repository>          # or obtain the source tree
cd Warden32
node --version                  # 20.19+ or 22.12+ (any newer major also works here)
npm ci                          # exact dependency tree from package-lock.json
npm test                        # 17 files / 144 tests — determinism contract intact
npm run dev                     # open the printed local URL
```

Then, in the app:

1. The sample project loads at boot (seed 1337). To start from a controlled
   state, use `new` or open a saved `.warden32` file.
2. Open **experiments**; the config defaults to `configFromProject` values
   (id `exp-<firmwareId>-<seed>`, duration 600 000 ms).
3. Run the battery. The page replays `buildSampleFlows()` — the fixed sample
   battery — against a clone of the project.
4. Export `experiment json` (full flow timeline), `experiment csv`, or
   `experiment markdown`; `run suite` produces
   `warden32-comparison-suite.md` for the three default configs.
5. To compare environments, exchange the exported JSON and the project file,
   not screenshots: same `engineVersion`, same project, same seed, same
   battery ⇒ identical verdicts, costs, rule-hit counters, and event counts.
6. For activity runs (`devices`/`activity` pages): same project, same seed,
   same window and mode ⇒ identical flow sets and byte accounting. The
   activity report exports (JSON/CSV/Markdown) carry mode, window, seed and
   the engine clock range; device or bandwidth edits clear the stored report,
   so a report always belongs to the project state it was produced from.

The test that enforces this contract is in `src/engine/experiment.test.ts`
("runs flows deterministically for the same config") in addition to the
engine-level reproducibility test.

## 5. Verifying the repository state itself

- `npm run typecheck` — strict TypeScript (including `noUnusedLocals` /
  `noUnusedParameters`); should exit 0.
- `npm test` — green suite; a failure means the deterministic contract
  described here is broken and any results should be considered
  non-reproducible until fixed.
- `npm run build` — production bundle in `dist/` (Vite `base: "./"`, so the
  built app also runs from `file://`).
- Design kit integrity: the three offline checks in
  `docs/STYLE.md` §7 (tag structure, inline script syntax, token drift).
  Expected outputs are recorded there; at the time of writing the kit passes
  all three and the 12 shared tokens show no drift.
- CI mirrors this: `npm ci && npm run typecheck && npm test && npm run build`
  on Node 22.

## 6. What is not guaranteed

- **Across engine versions.** `ENGINE_VERSION` is embedded precisely so you
  can tell: a result exported under 0.3.0 is not comparable to a result from
  a later engine without a deliberate re-run.
- **Across different batteries.** Suites and single runs replay the fixed
  `buildSampleFlows()` battery; comparing a run from a different battery (for
  example a future generated-flow mode) is only valid if the flow set is
  identical.
- **Against physical hardware.** Engine numbers are estimates pending
  hardware calibration (milestone M8); reproducibility here means
  "same simulated result", not "matches a real ESP32". The validation
  checklist exists to record real measurements against the model, and the
  two are kept visually distinct (provenance tags, `no-data` status before
  measurements).
- **Wall-clock metadata.** `exportedAt`, autosave timing, and the prefs
  `recentProjectName` are environment-dependent by design and never feed into
  results.

## 7. Archival recipe

To archive a result so a third party can reproduce it:

1. The project file (`save` → `<name>.warden32`), which carries the checksum.
2. The experiment export (`experiment json`), which carries `engineVersion`,
   the config (`firmwareId`, `seed`, `policyBaseline`, `durationMs`), the
   full flow timeline, and per-figure provenance. For activity runs, the
   `warden32-activity.json` export (mode, window, seed, engine clock range,
   per-device accounting) takes the same role.
3. The source revision (commit hash) of the lab.
4. Optionally the `markdown` export of the same run for human reading.

With those four items, `docs/EXPERIMENT-METHODOLOGY.md` §2 describes the
exact procedure a reviewer would replay to obtain identical numbers.
