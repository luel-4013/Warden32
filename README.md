# Warden32

An honest, deterministic, fully offline lab for studying what an ESP32-based
guest-network firewall/NAT router actually can and cannot enforce. It simulates
an ESP32-WROOM-32D + LAN8720 (WAN ethernet → Wi-Fi guest AP for ~5–10 IoT
devices) with a real evaluation pipeline — firewall dialects, connection
tracking, double NAT, port forwarding, routing — plus an attack lab, incident
response, resource model and a reproducible experiment runner. Nothing is faked
to look enforceable: where the stock firmware cannot act, the lab says so.

**Status:** M1–M10 complete — engine, UI, docs, CI. 144 tests green. Hardware
validation pending (no measured columns are populated; see
`docs/HARDWARE-CHECKLIST.md`).

Design kit: `ui-demo.html` (theme #19).

## What you can do

- **Topology + sample network** — five zones, IoT devices, WAN/guest interfaces,
  drag-and-drop `.warden32` project files, autosave.
- **Rules & firmware dialects** — edit stateful rules, the stock 4-list ACL
  (`parseStockAclLine`), port forwards; switch between `stock-eth`, `stock-wifi`,
  `softap-sta` and `target-v1` and watch verdicts change.
- **Traffic lab** — device behavior states (normal/noisy/misconfigured/
  compromised), ten deterministic traffic profiles, per-device flow generation.
- **Device management & bandwidth** — add/remove IoT devices (archetype, zone,
  demand, optional cap) with deterministic addressing; configure the uplink
  link rate; capacity accounting reports saturation and over-subscription
  against both the link rate and the 5–15 Mbps routed-throughput estimate.
  Caps are honestly labelled `not enforceable` targets.
- **Activity simulation** — normal vs compromised IoT behaviour (updates,
  telemetry, streaming; C2 beaconing, DNS tunnelling, LAN scanning,
  exfiltration) for 5 m–24 h windows, evaluated through the real pipeline
  with per-device accounting and JSON/CSV/Markdown exports.
- **Attack lab** — 12 scenarios with honest labels; `wifi-deauth` and
  `dhcp-starvation` are explicitly *not modeled*. Stock lateral movement
  succeeds because SoftAP has no client isolation (esp-idf #13781, not planned).
- **Incident response** — incident log, quarantine/release, `addBlockRule`
  (the stock dialect honestly refuses: it cannot block a source host).
- **Resource model** — RAM (180 KB base + per-flow costs), CPU window, airtime,
  TX queue, conntrack/NAPT capacity; 7 failure injections; link/device toggles.
- **Experiments** — baselines P-A/P-B/P-C(+P-D label), suite runner, comparison
  table, JSON/CSV/Markdown exports with provenance and engine version.
- **Calibration & validation** — exportable calibration profile
  (`warden32.calibration` v1) and a hardware validation checklist that never
  invents measured values.

## Honesty laws (enforced in code)

- Unenforceable traffic is labelled `not enforceable` — never "blocked".
- Every number carries provenance: measured | datasheet | paper | estimate |
  assumption.
- Hypothetical profiles are labelled `not implemented on hardware` everywhere.
- Calibration defaults are `assumption`-tagged placeholders; importing a
  profile validates and displays it, it never silently becomes "measured".
- Animations fire only on real engine events — no ambient motion.

## Quickstart

```
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc --noEmit
npm test           # 144 deterministic tests
npm run build      # typecheck + production build
npm run make-pdf   # regenerates docs/Warden32-User-Guide.pdf
```

## Architecture

```
src/app        React UI — IDE shell, 14 pages, store, primitives
src/engine     pure TS simulation core — pipeline, firewall, NAT, conntrack,
               routing, resources, attacks, experiments, calibration, validation
src/registry   boards, ethernet adapters, firmware profiles, device archetypes
src/storage    .warden32 project files, autosave, exports
src/data       deterministic sample lab (seed 1337)
docs           ARCHITECTURE, PIPELINE, FIREWALL, VERIFIED-FACTS, CLAIMS-MATRIX,
               LIMITATIONS, HARDWARE-CHECKLIST, EXPERIMENT-METHODOLOGY, ...
```

Pipeline order: classify/visibility → offline → quarantine → spoof check →
esp32-local/inbound/outbound → policy (dialect rules + egress only under
stateful) → NAPT double NAT → route lookup → upstream → verdict + event stream.
Details in `docs/PIPELINE.md`.

## What this is NOT / Limitations

- Not a packet-level bench: no lwIP emulation, no radio/timing/thermal physics.
- RAM/CPU/airtime values are calibrated **estimate** models, not measurements.
- Attack coverage is explicit, not complete: unmodeled scenarios stay empty and
  labelled.
- The simulation reproduces itself, not hardware — use the exported validation
  checklist to replace assumptions with real numbers. Full list:
  `docs/LIMITATIONS.md`.

## Responsible use

The attack scenarios exist for defensive research on networks and hardware you
own or are authorized to test. Do not use any technique demonstrated here
against systems you do not control. Reporting and scope: `SECURITY.md`.

## Docs & contributing

- New here? Read `docs/USER-GUIDE.md` (or the generated
  `docs/Warden32-User-Guide.pdf`).
- Start with `docs/ARCHITECTURE.md`, `docs/PIPELINE.md`, `docs/FIREWALL.md`.
- Methodology: `docs/EXPERIMENT-METHODOLOGY.md`, `docs/REPRODUCIBILITY.md`,
  `docs/TEST-PLAN.md`.
- Extending: `docs/EXTENDING.md` · Design system: `docs/STYLE.md`.
- Background: `docs/MARKET-RESEARCH.md`, `docs/PREMORTEM.md`,
  `docs/DECISIONS.md`.
- Contributing: `CONTRIBUTING.md` · Changelog: `CHANGELOG.md` ·
  License: MIT (`LICENSE`).

## CI

`.github/workflows/ci.yml` runs typecheck → tests → build on push/PR.
