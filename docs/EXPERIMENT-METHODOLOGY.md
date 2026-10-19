# Experiment methodology

This document describes what an experiment in Warden32 is, how a run is
executed, what every number means and how it is tagged, and which conditions
must hold for two runs to be comparable.

Core property: an experiment is a **deterministic replay**. Given the same
project, the same flow battery, the same config, and the same engine version,
it produces byte-identical results. There is no wall clock and no
`Math.random` anywhere in the run path; all randomness derives from
`mulberry32` seeds, and all time is virtual (`SimClock`).

## 1. Anatomy of a config

`ExperimentConfig` (`src/engine/experiment.ts`):

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable identifier; `configFromProject` builds `exp-${firmwareId}-${seed}`. |
| `name` | string | Display label (page default: "sample battery run"). |
| `notes` | string | Free-form notes carried into exports. |
| `firmwareId` | `FirmwareProfileId` | Which firmware profile the cloned project runs. |
| `seed` | number | Seed for the engine RNG; defaults to the project's `sim.seed`. |
| `policyBaseline` | `P-A` \| `P-B` \| `P-C` \| `P-D` | Label of the intended policy posture (recorded in results and exports). |
| `durationMs` | number | Virtual-time cap; `configFromProject` sets 600 000 ms (10 simulated minutes). |

Baseline vocabulary (`ExperimentsPage`):

| Id | Label | Meaning |
| --- | --- | --- |
| `P-A` | bare forwarding/NAT, no filtering | The `softap-sta` minimal baseline; no management surface. |
| `P-B` | stock stateless ACL, default-allow | Stock stateless 4-list IPv4 ACL, first-match, default-allow; non-IPv4 passes unfiltered. |
| `P-C` | stateful default-deny + egress restriction | Stateful 5-tuple default-deny + egress allowlist; hypothetical custom firmware, not implemented on hardware. |
| `P-D` | P-C + DNS sinkhole + full logging | P-C plus DNS interception/sinkhole and full logging; hypothetical, not implemented on hardware. |

Honest limits of the baseline field: the engine applies the firmware
profile's dialect/default-policy mapping (section 2), not the baseline id.
P-C corresponds to `target-v1` behavior today. **P-D is a label only** — the
DNS sinkhole and full-logging features are not applied by any code path
(`firmware.dnsSinkhole` is not consulted by the engine), and P-A is only
reachable when the `softap-sta` profile is selected. Selecting a baseline
that contradicts a firmware profile changes a label in the result metadata,
not behavior; the UI prints the selected baseline description beneath the
config to keep this visible.

## 2. What happens during a run

`runExperiment(baseProject, config, flows)` performs, in order:

1. **Clone.** `JSON.parse(JSON.stringify(baseProject))` — the live project is
   never mutated (asserted by `experiment.test.ts`).
2. **Apply the config.** Overwrites `sim.firmwareId`, `sim.seed`, and
   `sim.policyBaseline` on the clone, then maps firmware to firewall dialect:

   | `firmwareId` | `firewall.dialect` | `firewall.defaultPolicy` |
   | --- | --- | --- |
   | `target-v1` | `stateful` | `deny` |
   | `softap-sta` | `none` | (unchanged from project) |
   | `stock-eth`, `stock-wifi`, anything else | `stock-4list` | `allow` |

   The same mapping is applied interactively by `store.applyFirmware`; both
   if/else chains must be updated together (see `docs/EXTENDING.md` §4).
3. **Construct a fresh `SimEngine`** on the clone. The engine resolves the
   board, adapter, and firmware by id and starts with empty NAT, conntrack,
   resource, and event state.
4. **Sort flows** by `timestampMs`, tie-broken by `id` (locale compare).
5. **Replay.** For each flow with `timestampMs <= durationMs`: advance the
   clock to the flow timestamp, then submit it. The first flow beyond
   `durationMs` ends the loop (flows are sorted, so this is a clean cut).
6. **Drain to the duration.** `engine.advanceTo(max(now, durationMs))` so
   timers (conntrack expiry, rate-limit windows) settle inside the window.
7. **Aggregate.** Count verdicts, sum CPU and airtime costs (rounded to two
   decimals), collect `ruleHits` for rules that matched at least once, take a
   resource snapshot, and record `startedAtMs`, `endedAtMs`, `eventCount`.
8. **Optionally expose the engine** via the `onEngine` callback (used by the
   UI to render the run's packets/console views).

The battery: the Experiments page replays `buildSampleFlows()` — the fixed
sample battery (7 flows covering allowed, denied, dropped, and
not-enforceable outcomes). It does not generate flows from the project's
traffic profiles; the panel states this explicitly ("flows = n
(buildSampleFlows() — the sample battery; durationMs caps flow.timestampMs
during the run)").

## 3. Metric definitions

The single-run table (`metricRows`) — every row carries provenance and a
`how` string shown in the UI:

| Metric | Value | Provenance | Basis stated in the UI |
| --- | --- | --- | --- |
| flows evaluated | counter | measured | Counted by the engine per submitted flow. |
| verdicts | `allow · deny · drop · n/e` | measured | Final pipeline verdict per flow. |
| CPU cost | number | estimate | 1.0 unit/flow Ethernet, 2.4 Wi-Fi uplink — engine constants, pending hardware calibration (M8). |
| airtime cost | number | estimate | 0.5/0.8 routed, 1.0 L2 relay — relative airtime model, pending calibration (M8). |
| RAM used | `x KB of y KB` | estimate | 180 KB base + 0.2 KB/connection + 0.15 KB/NAPT mapping + 1.6 KB/queued buffer. |
| conntrack | `used of capacity` | measured | Connection-table occupancy at end of run. |
| rule hits | `ruleId:hits` list or `none` | measured | Incremented when a rule matches during evaluation. |

Verdict semantics (the most important interpretation rule in the lab):

| Verdict | Meaning | Never means |
| --- | --- | --- |
| `allowed` | The pipeline permitted the flow. | "Safe". An allowlisted exfiltration is `allowed`. |
| `denied` | Policy explicitly blocked the flow. | — |
| `dropped` | A failure or boundary condition prevented delivery (no route, RAM, tx queue, NAT boundary, rate limit…). | "Blocked by policy". Inspect the flow labels. |
| `not-enforceable` | The enforcement point never saw the frame (guest-to-guest L2 relay, non-IPv4 through the stock IPv4-only ACL). | "Blocked". This is the label that keeps the lab honest about what the ESP32 cannot see. |

## 4. Comparing runs

`compareResults(results)` requires at least two results and produces ten
rows. Deltas are computed as **last minus first** and rendered with an
explicit sign. Directional readings (`ComparePage.READING`):

| Row | Provenance | Better direction | Note (from the UI) |
| --- | --- | --- | --- |
| flows | measured | neutral | The identical sample battery is replayed for every config. |
| allowed | measured | lower | Fewer flows pass without policy action. |
| denied | measured | higher | More traffic explicitly enforced; review false positives. |
| dropped | measured | neutral | Drops mix policy enforcement and failures — inspect per-flow reasons. |
| not enforceable | measured | lower | Fewer frames the firewall cannot see at all. |
| total CPU cost | estimate | lower | Less estimated CPU demand. |
| total airtime cost | estimate | lower | Less estimated airtime shared with the uplink. |
| peak CPU load | estimate | lower | Less estimated saturation inside the 1 s window. |
| connections tracked | measured | lower | Smaller live state in the heap. |
| engine version | measured | neutral | Same deterministic engine for every config; delta shown as `—`. |

The default suite (`defaultComparisonConfigs`) runs three configs, all
sharing the project's seed, baseline, and duration: `Stock — Ethernet
uplink` (`stock-eth`), `Stock — Wi-Fi uplink` (`stock-wifi`), and `Target
design v1` (`target-v1`). P-A and P-D are not part of the default suite; P-A
is reachable by running a single experiment with `softap-sta`, and P-D is
label-only (section 1). The suite export joins the per-run Markdown reports
into `warden32-comparison-suite.md`.

## 5. Outputs and artifact trail

`ExperimentResult` contains: the config, `engineVersion`, engine counters,
verdict counts, the full `FlowResult[]` timeline, total CPU/airtime costs,
rule-hit list, resource snapshot, start/end virtual times, and event count.

Exports (`src/storage/exports.ts`), all offline:

| Function | Format | Carries |
| --- | --- | --- |
| `experimentToJson` | JSON | Full flow timeline with labels and per-flow costs. |
| `experimentToCsv` | CSV | One row per flow plus header. |
| `experimentToMarkdown` | Markdown | Provenance table and verdict list. |
| `experimentFileName` | filename helper | Extension-parameterized naming. |

Every artifact carries `engineVersion` and per-figure provenance; an exported
result is only comparable to another export with the same `engineVersion`,
the same project source, the same seed, and the same battery.

## 6. Reproducibility contract and validity threats

Contract (verified by tests): same engine version + same project JSON + same
battery + same seed ⇒ identical verdicts, identical costs, identical rule
hit counters, identical event counts (`engine.test.ts` reproducibility test,
`experiment.test.ts` determinism test).

Validity threats to state alongside any result:

- **Estimates are not measurements.** CPU, airtime, and RAM rows are model
  estimates pending hardware calibration (milestone M8). The lab prints
  provenance precisely so these are never mistaken for measured data.
- **The battery is small and fixed.** It is a demonstration battery, not a
  workload characterization.
- **Cost model simplifications.** Routed CPU/airtime costs come from
  firmware-uplink calibration defaults; per-adapter `cpuCostPerPacket` and
  `nominalMbps` are registry display data not wired into run costs, and
  `firmware.naptCapacity` is display-only (the engine uses
  `project.resources.naptCapacity`).
- **Imported calibration affects validation only.** A calibration profile
  imported in the Hardware page supplies expected values for the validation
  checklist; it does not change engine cost constants, because the engine is
  constructed with the calibration defaults.
- **Single-threaded deterministic model.** No radio timing, no queueing
  jitter beyond the modeled tx queue, no OS scheduling effects. The engine is
  an explanatory simulator, not a cycle-accurate one.
