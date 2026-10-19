# Limitations

This document is the repository-level statement of what the Warden32 lab is
not, which simplifications its models make, what would falsify the model, and
how the exported validation checklist connects the simulation to future
hardware measurements. It aligns with the in-app statement in
`src/app/pages/DocsPage.tsx` (section "what this lab is / is not") and with
`docs/PREMORTEM.md` (trust-collapse prevention). New numbers are not introduced
here; every value repeats its source and provenance tag.

## What the lab is

A deterministic, offline, browser-based simulation of the ESP32 firewall/NAT
pipeline: scope and visibility classification, policy dialects, connection
tracking, double NAT, DNAT port-forwards, routing, resource limits and
per-flow verdicts. Same project file plus same seed produce an identical event
stream (`src/engine/engine.ts`, `src/engine/clock.ts`, `src/engine/rng.ts`;
tests `src/engine/engine.test.ts:129-142`, `src/engine/experiment.test.ts:17-23`).
It runs entirely in the browser with no accounts, no backend, no network I/O
and no real attack traffic (`src/app/pages/DocsPage.tsx:109-113`).

## What the lab is not

| Not this | Consequence in the lab | Repository source |
| --- | --- | --- |
| Not a packet-level bench | Traffic is discrete `Flow` / `FlowResult` records evaluated by the pipeline; there is no frame serialization, wire timing, capture file or PCAP-grade fidelity. | `src/engine/types.ts:26-38,80-95`; `src/app/pages/DocsPage.tsx:119-123` |
| No real radio model | No 802.11 rates, retries, collisions or airtime fairness. L2-relayed frames cost one relative airtime unit (`AIRTIME_L2_RELAY = 1.0`, `estimate`) and zero CPU; airtime is a bookkeeping model, not a radio simulation. | `src/engine/calibrationDefaults.ts:5`; `src/engine/engine.ts:328-338`; `src/app/pages/DocsPage.tsx:219-224` |
| No timing, thermal, EMI or silicon-errata physics | None of these effects exist anywhere in the engine. | `src/app/pages/DocsPage.tsx:219-224` |
| No lwIP emulation | The engine is purpose-built TypeScript (`routing.ts`, `nat.ts`, `conntrack.ts`, `firewall.ts`); it follows the documented lwIP build options (see `docs/FIRMWARE-MAPPING.md`) but does not embed or port lwIP. Stack internals — pbuf handling, TCP state machine, retransmission, windowing — are not simulated. The TCP lifecycle is documented as approximate (spec §7) and its timeouts are `estimate` values (`TCP NEW 10 s`, `established 300 s`, `UDP 30 s`, `DNAT 120 s`; `docs/DECISIONS.md` M3). | `src/engine/conntrack.ts:1-7`; `docs/DECISIONS.md` (M1, M3); spec §7 |
| RAM, CPU and airtime are calibrated estimate models, not measurements | Every resource snapshot carries `provenance: "estimate"`: base heap `RAM_BASE_KB = 180` KB, `0.2` KB per connection, `0.15` KB per NAPT mapping, `1.6` KB per queued buffer; CPU costs `1.0` (Ethernet) / `2.4` (Wi-Fi uplink) units per flow; airtime `0.5` / `0.8` / `1.0` relative units; 12 CPU units/s and 10 airtime units/s windows; tx drain 50/s. Imported calibration can replace these per metric, but until then they are assumptions. | `src/engine/calibrationDefaults.ts:1-6`; `src/engine/resources.ts:6-12,94-116`; `docs/DECISIONS.md` (M6); `src/app/pages/HardwarePage.tsx:341-345,392-396` |
| Upstream NAT is simplified | The upstream home router is a deterministic table, not a real NAT: no timing, pinhole or carrier-grade behavior. | `src/app/pages/DocsPage.tsx:226-231` |
| No firmware control or flashing | The browser app never flashes, reboots or talks to hardware. Hardware work is manual and lives in `docs/HARDWARE-CHECKLIST.md`. | Spec §4 ("Out"); `src/app/pages/DocsPage.tsx:119-123` |
| No real attacks, scanning or network I/O | All attack scenarios, scans and hostile device behavior exist only inside the simulation; the app never contacts the fictional endpoints. | Spec §2; `src/app/pages/DocsPage.tsx:241-247` |

## Model simplifications

| Area | Simplification | Repository source |
| --- | --- | --- |
| Visibility model | Four rules over zones and protocol only: destination is the router → `esp32-local`; protocol `OTHER` → `wifi-management` (not enforceable); guest→guest → `guest-L2-peer` (not enforceable); guest↔internet/upstream → `internet-routed`; everything else → `lan-routed`. No radio state, RSSI, association state or MAC-layer condition is consulted. | `src/engine/visibility.ts:11-67` |
| Deterministic clock | Virtual, monotonic, no wall-clock reads; timers tie-break by insertion order. Scheduling exists (connection expiry, resource windows) but outcomes never depend on real time. | `src/engine/clock.ts:49-76`; `docs/DECISIONS.md` (M2) |
| Randomness | Seeded `mulberry32` with FNV-style seed derivation; identical configuration plus seed produce identical flows and verdicts. | `src/engine/rng.ts`; `src/engine/traffic.ts:173-182`; `src/engine/traffic.test.ts:47-53` |
| Archetype-based devices | The library ships 23 archetype entries in `DEVICE_ARCHETYPES` (15 consumer IoT; 2 zone hosts with `category: iot`; 3 infrastructure; 3 external) and 10 traffic profiles. Real gadgets must be approximated from or added to these entries; archetype traffic cadence is `paper` (IoTDI 2020) or `assumption`. | `src/registry/devices.ts`; `src/engine/traffic.ts:43-141`; `docs/DECISIONS.md` (M4) |
| Attack scenarios | The catalog has 12 scenarios; 10 are modeled and 2 are explicitly not modeled (`wifi-deauth`, `dhcp-starvation`) with empty flow lists and disabled run buttons. Wi-Fi-layer attacks cannot be simulated honestly without a radio model. MAC/association flood is modeled as generic non-IP frames (`AIRTIME` traffic), tagged `estimate`. CPU saturation is deliberately not injectable. | `src/engine/attacks.ts:229-272`; `src/engine/failures.ts:70-78`; tests `src/engine/attacks.test.ts:32-40` |
| Compromise model | "Compromise" only swaps/augments generated traffic: C2 beacons every `30 000 ms` (±`3 000 ms`), 3 lateral probes `2 000 ms` apart, DNS tunnel queries every `15 000 ms`. It grants no special access; all flows travel the same pipeline. | `src/engine/traffic.ts:149-163,219-279`; spec §11 |
| Rate limits | A fixed 1000 ms token window kept in engine memory (deterministic, advances with the virtual clock only). | `src/engine/engine.ts:32,905-916`; `docs/DECISIONS.md` (M3) |
| Quarantine | Engine-level denial with honest labels; on stock firmware it is a simulation response, not a real isolation mechanism (stock cannot isolate a client). | `src/engine/engine.ts:296-326`; tests `src/engine/incident.test.ts:53-92` |
| Device egress allowlists | `vendor-only` / `block-all` only take effect under the `stateful` dialect; stock and baseline profiles ignore them. | `src/engine/policy.ts:17-41`; `src/engine/engine.ts:655-673` |
| NAPT capacity binding | `naptCapacity` binds at engine start; the "NAPT table exhaustion" failure injection applies on the next engine rebuild. | `src/engine/failures.ts:52-60`; `docs/DECISIONS.md` (M6) |
| CPU saturation behavior | Above 100% modeled CPU load the engine adds a latency label instead of dropping flows — "real firmware adds latency, not loss". | `src/engine/engine.ts:210-216`; `docs/DECISIONS.md` (M6) |
| Buffers and queues | One transmit queue with `txQueueLength` capacity and a deterministic drain (`50/s`); burst overflow drops the flow. No per-interface queues, no AQM. | `src/engine/resources.ts:44-64`; tests `src/engine/resources.test.ts:45-71` |
| Event log | Capped at 20 000 events; older events are evicted (the UI reads bounded windows). | `src/engine/events.ts:8-19` |

## What would falsify the model

The falsification list is maintained in `src/app/pages/DocsPage.tsx:233-240`
and reproduced here:

- Recorded hardware numbers outside the checklist tolerance bands
  (throughput, clients, free heap).
- A two-client lateral test showing host-to-host frames reaching lwIP —
  this would contradict the no-isolation model (issue #13781).
- Stock ACL behavior that is not stateless 4-list default-allow.
- RMII working on an S2/S3/C3-class chip (contradicting the EMAC facts).

The exported validation plan (`validationToMarkdown`) is the executable
attempt at the first item; the two-client lateral test and the ARP visibility
test from spec §17 are the attempts at the second.

## How the validation checklist connects simulation to hardware measurement

`buildValidationChecklist(project, calibration)` (`src/engine/validation.ts:22-74`)
returns exactly four rows. Expected values come from an imported calibration
profile when one supplies them; otherwise they are model targets or `null`:

| Check id | Label | Unit | Target before calibration | Tolerance |
| --- | --- | --- | --- | --- |
| `throughput-lan-wan` | LAN→WAN throughput | Mbps | `null` until calibration is imported; in-code note "stock firmware reports 5–15 Mbps routed" (`estimate`) | ±20% |
| `throughput-wan-lan` | WAN→LAN throughput | Mbps | `null`; note "inbound is usually slightly slower on this class of device" (`estimate`) | ±20% |
| `clients` | Concurrent clients | clients | 8 (`estimate`); 12 for `target-v1` | ±25% |
| `ram` | Free heap at idle | KB | `board.ramKb − 180 KB` (board SRAM `datasheet`, consumed base `estimate`) | ±30% |

Connection rules (`evaluateValidation`, `src/engine/validation.ts:76-86`):
nothing entered → `no-data`; `|delta| <= tolerance` → `ok`; `<= 2×tolerance` →
`warn`; beyond → `fail`. `recordMeasurement` stores only numbers the user
types, and the exported Markdown states: "the lab never invents `measured`
values" (`src/engine/validation.ts:106`). A `warden32.calibration` import
supplies the "expected" column and is validated on parse
(`src/engine/calibration.ts:96-152`); in the current UI build the imported
profile is not written into the project and the engine keeps its defaults
(`src/app/pages/HardwarePage.tsx:429-433`).

The measurement procedures that feed these four rows are in
`docs/HARDWARE-CHECKLIST.md`. Spec §17 also lists latency, ACL counters, the
two-client lateral-movement proof, ARP visibility, reboot policy and NAPT
pressure procedures; those are not encoded as checklist rows in this build and
must be recorded as supplementary notes.
