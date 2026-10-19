# Contributing to Warden32

Warden32 is an offline, deterministic browser simulation lab of an ESP32 IoT
firewall/NAT router, built for a research paper and a public release. It is a
simulation: it never touches a real network. Contributions are welcome —
engine behaviour, registry data, scenarios, UI, tests and documentation.

## Honesty laws (hard contribution rules)

These are not aspirational. PRs that break them are rejected. They encode the
project's honesty laws.

1. Never present simulated values as hardware evidence. A simulated throughput
   or client count is not a benchmark.
2. Every number carries a provenance tag:
   `measured | datasheet | paper | estimate | assumption`. If you cannot source
   it, mark it `assumption` and say so.
3. Traffic the enforcement point cannot see is labelled `not enforceable` —
   never "blocked".
4. Hypothetical firmware/policy profiles are labelled
   `not implemented on hardware` everywhere they are shown or exported.
5. The application never generates real network traffic, scans or attacks.

## Dev setup

- Node.js 22 or newer (CI runs Node 22 via `actions/setup-node`; no
  `engines` field is pinned yet).

```
npm install
npm run dev        # Vite dev server, http://localhost:5173
npm run typecheck  # tsc --noEmit
npm test           # Vitest, headless and deterministic
npm run build      # typecheck + production build
npm run preview    # serve the production build
```

There is no lint script. CI runs `npm ci` → `npm run typecheck` → `npm test`
→ `npm run build` (see `.github/workflows/ci.yml`). All three checks must pass
before a PR can merge.

## Repository layout

- `src/engine/` — pure simulation core: clock, seeded RNG, routing, firewall,
  NAT, connection tracking, traffic, attacks, incident, resources, failures,
  calibration, validation, experiments, events, model and types. No React, no
  I/O, no wall-clock.
- `src/registry/` — registry data: `devices.ts` (device archetypes),
  `profiles.ts` (boards, Ethernet adapters, firmware profiles).
- `src/storage/` — `.warden32` project serialization and validation, autosave
  and preferences, JSON/CSV/Markdown exports.
- `src/data/` — the sample lab project and its deterministic flow battery.
- `src/app/` — React UI: store, pages, components, topology canvas, styles.
- `docs/` — decisions log, premortem, market research, and the extension and
  methodology docs.
- `.github/` — CI workflow, issue templates, PR template.

## Coding conventions

Follow what the code actually does:

- Double quotes, 2-space indent, semicolons.
- No comments in source; the code should read on its own.
- Engine code is pure TypeScript and independent of React; it runs headless in
  Node for tests and CI experiments.
- Determinism is the product: same project + same seed ⇒ identical results.
  Randomness goes through the seeded RNG (`src/engine/rng.ts`). Never call
  `Math.random`, `Date.now` or wall-clock timers in the engine — simulation
  time comes from the `SimClock`.
- The UI never makes enforcement decisions; it displays what the engine
  computed.

## Extending the lab

Worked schema walkthroughs (add a device, board, Ethernet adapter, firmware
profile or scenario) live in `docs/EXTENDING.md`. The data locations:

- device archetype → `src/registry/devices.ts`
- board, adapter, firmware profile → `src/registry/profiles.ts`
- traffic profile → `src/engine/traffic.ts`
- attack scenario → `src/engine/attacks.ts`
- failure injection → `src/engine/failures.ts`

Every registry entry needs provenance. If something cannot be modelled
honestly (for example radio-layer frames), add it with `modeled: false` and an
explanation instead of faking a result.

## Test requirements

- All tests must be deterministic — no wall-clock, no network, no shared
  mutable state between tests.
- New engine behaviour needs tests next to the source (`*.test.ts`). Cover
  ordering, boundary conditions and timeouts, not just the happy path.
- UI smoke tests render pages server-side and live in `src/app/`.
- Before opening a PR: `npm run typecheck && npm test && npm run build`.

## Pull request checklist

Aligned with `.github/pull_request_template.md`:

- [ ] Summary of what changed and why.
- [ ] No simulated measurement is presented as hardware evidence.
- [ ] New numbers carry provenance tags
      (measured | datasheet | paper | estimate | assumption).
- [ ] Hypothetical profiles are labelled `not implemented on hardware`.
- [ ] `npm run typecheck`, `npm test`, `npm run build` all pass.

CI runs on every pull request and on pushes to `main`; keep it green.

## Issue etiquette

- Use the Bug report template for incorrect or dishonest behaviour and include
  the firmware profile, policy baseline (P-A/P-B/P-C), the flow or scenario,
  and how to reproduce it (project + seed).
- Use the Feature request template for new devices, boards, adapters, firmware
  profiles, scenarios or features. Provenance for every new number or claim is
  required before the issue can be accepted.
- One topic per issue. Search existing issues first.
- Reports claiming hardware behaviour must state the measurement method and
  the hardware involved; otherwise the lab will treat them as assumptions.
