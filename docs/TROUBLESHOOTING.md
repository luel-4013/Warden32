# Troubleshooting

Symptom-first guide. Each entry gives the exact message or behavior you will
see, what it means, and what to do. Everything here is based on the current
build; messages are quoted verbatim from the source.

## 1. Install and run

| Symptom | Cause | Fix |
| --- | --- | --- |
| `npm install` warns or fails about the Node engine | Vite 8 requires Node `^20.19.0 || >=22.12.0` | Check `node --version`; use Node 22 LTS (the version CI uses) or newer supported. |
| `vitest: command not found` | Dependencies not installed | `npm ci`; invoke as `npx vitest run` or `npm test`. |
| Blank page after `npm run build` | Opened the wrong HTML file | Open `dist/index.html` (Vite `base: "./"` makes it work from `file://`); the root `index.html` is the dev template and needs `npm run dev`. |
| `npm run dev` port in use | Vite default port taken | Vite prints the actual URL; use it, or stop the other process. |

## 2. Opening and saving projects

`open failed: …` messages are the joined parse/validation errors.

| Message contains | Meaning | Fix |
| --- | --- | --- |
| `not valid JSON: …` | The file is not JSON (truncated, wrong file). | Re-export from the app; do not hand-fix binary damage. |
| `file is not a Warden32 project object` | JSON parsed but is not an object (array, string, number). | Open the exported `.warden32` file itself, not a wrapper. |
| `unknown schema "…" (expected warden32.project)` | Wrong file type. | Check you are not opening a calibration file (kind `warden32.calibration`) or an experiment export. |
| `schema version N is newer than this build supports (1)` | File written by a future build. | Update the source; do not downgrade the file. |
| `checksum mismatch (file …, computed …) — file may be corrupted` | The `project` block changed after the checksum was written (hand edits, partial copy). | Re-export from the app. Programmatic recovery exists: `parseProject(text, { skipChecksum: true })` accepts the file with warning `checksum verification skipped` (covered by `project.test.ts`); the app UI itself does not offer this option. |
| Open succeeds with `· n warning(s)` | Non-blocking validation findings | Read the warnings: duplicate device addresses or a `sim.publicIp` outside the RFC 5737 documentation ranges (`203.0.113.0/24`, `198.51.100.0/24`, `192.0.2.0/24`) are the current ones. |
| Hand-edited file lost your extra fields | It should not have | Unknown fields inside `project` are preserved by round-trip; if they were dropped, check they were nested under `project`, not at the envelope level. |

Notes:

- Saves always stamp the current `ENGINE_VERSION` (`0.3.0`) and re-compute
  the checksum; any edit changes the checksum.
- The app restores the last autosave (`warden32.autosave.v1`) at boot. If an
  old project keeps appearing, use `new` to reset, or clear the key in
  DevTools: `localStorage.removeItem("warden32.autosave.v1")`. With storage
  disabled entirely, autosave silently does nothing (by design) and the
  sample project loads each boot.

## 3. Engine construction failures

These appear when a project passes file validation but the engine cannot
resolve a registry id. Project validation only checks that ids are strings,
so typos surface here.

| Error | Cause | Fix |
| --- | --- | --- |
| `unknown board: <id>` | `sim.boardId` not in `HARDWARE_PROFILES`. | Set it to a shipped board id; see the hardware page table or `src/registry/profiles.ts`. |
| `unknown adapter: <id>` | `sim.adapterId` not in `ETHERNET_ADAPTERS`. | Same fix against the adapter list. |
| Crash (`Cannot read properties of undefined`) naming the firmware | `sim.firmwareId` not a key of `FIRMWARE_PROFILES`; this lookup is unguarded by design gap. | Set `sim.firmwareId` to `stock-eth`, `stock-wifi`, `softap-sta`, or `target-v1`. Prefer the top-bar firmware selector, which keeps every dependent field in sync. |

## 4. Flow verdicts that look wrong

### "Not enforceable" is not an error

Guest-to-guest traffic and non-IPv4 frames through the stock IPv4-only ACL
are labeled `not-enforceable` because the modeled enforcement point never
sees them. This is the lab's core honesty behavior; the label must never be
read as "blocked". If you need to remove the condition: for non-IPv4 there is
no fix in the model (the stock ACL is IPv4-only); for guest-to-guest, no
single-radio AP configuration in this model filters the L2 relay. The
explanatory text is attached to the flow.

### Drops and their labels

| Label / event | Meaning | What to do |
| --- | --- | --- |
| `NAPT table exhausted` (error `NAPT table of <hostId> is full`) | The NAPT table hit its capacity (default 2048; project `resources.naptCapacity`). | Reduce concurrent flow volume; raise the capacity in the project; or treat it as the intended finding from the `napt-exhaustion` injection. |
| `RAM model: heap exhausted — cannot allocate connection state` | The RAM estimate exceeded the budget (board `ramKb` minus base, with per-connection/NAPT/buffer costs). | Remove the RAM override, lower conntrack capacity, or accept the finding — the refusal is correct model behavior, not a bug. |
| `tx queue full — buffer exhaustion (estimate)` | A burst exceeded the modeled tx queue and drained before the flow could go out. | Space the burst (raise interval) or accept the modeled drop; see the `tx-queue-pressure` injection. |
| `CPU load estimate above 100% — real firmware would add latency, not drop (estimate)` | The window's CPU estimate saturated. | By design the engine flags saturation and does **not** drop the flow; if you expected drops, this is the wrong model on purpose. Replay fewer/noisier flows or lower expectations. |
| `no route` / routing failure | Destination outside connected networks and no usable default/static route (interfaces that are down are reported as candidates). | Check interface states and the route list; a disabled route is excluded with a reason. |
| Inbound flow dropped at the upstream NAT boundary | The upstream router has no forward for that port; a port-forward is only reachable when **both** NAT layers forward it. | Add the missing forward (both sides for chained NAT); this is asserted by the DNAT tests. |
| `spoofed source` drop | Ingress source check: the source address does not belong to the ingress network. | Expected for the `spoofed-source` scenario; otherwise check the device's address/network. |
| Rate-limit drop | A rule's per-window limit was reached (window resets each simulated second). | Expected under flood scenarios; adjust the rule if it is not the point of the experiment. |

### Quarantine and incident actions

| Symptom | Meaning |
| --- | --- |
| Flows from *and* to a quarantined device are dropped with honest labels | Correct: quarantine isolates the device in both directions; release restores flow. |
| A block rule added on the stock ACL does not stop a guest-to-guest source | The stock datapath cannot match that traffic; the incident view explains why. Switch the project to `target-v1` to make the action effective, or use quarantine. |
| Actions refused on an incident | The incident is closed; the lifecycle is open → contained → closed and closed incidents are terminal. |

## 5. Traffic page shows `0 flows`

Two exact messages, both intentional:

- `0 flows — no traffic profile assigned (trafficProfileId "none")` — assign
  a profile id to the device in the project.
- `0 flows — profile "<id>" is not registered in TRAFFIC_PROFILES (project
  value); the registry archetype id was not substituted` — the device's
  `trafficProfileId` is not in the generator catalogue (`stream-camera`,
  `telemetry-mqtt`, `sensor-small`, `hub-aggregator`, `stream-media`,
  `appliance-burst`, `lock-event`, `generic-embedded`, `noisy-chatter`,
  `misconfig-retry`). The page deliberately does not silently substitute the
  archetype's profile. Fix by setting the device's `trafficProfileId` to a
  registered id, or register a matching profile per `docs/EXTENDING.md` §6.
  (The sample project was corrected in M10 to use registered ids; the
  activity page additionally falls back to `generic-embedded` for unknown
  profiles, with a note in the report.)

Related: steps whose target cannot be resolved are skipped (resolve via exact
device id, `guest-local`, or the `vendor-cloud` / `c2` / `dns-server` /
`ntp-pool` name patterns). A profile that yields fewer flows than steps has
unresolved targets, not a bug.

## 6. Failure injections

The resources page lists seven injections: `uplink-down`, `guest-ap-down`,
`ram-pressure`, `tx-queue-pressure`, `napt-exhaustion`, `dns-offline`, and
`cpu-pressure`. If a control is disabled with an explanation, that is
deliberate: `cpu-pressure` is documented as `Not injectable: CPU load is an
output of replayed traffic, not a setting. Replay a noisy device instead.`
The dispatcher strips the `Not injectable: ` prefix for display. Do not
invent alternate causes for disabled entries.

## 7. Results and baselines that appear to "do nothing"

| Symptom | Explanation |
| --- | --- |
| Selecting baseline `P-D` changes nothing | P-D (DNS sinkhole + full logging) is a **label only** in this build; no code path applies those features. The UI prints the baseline description so the gap stays visible. |
| `P-A` behaves like "no filtering" | Correct: P-A corresponds to the `softap-sta` profile, whose dialect is `none`. |
| Switching firmware clears the run results | By design (`applyFirmware` clears results); rerun the battery. |
| Imported calibration did not change engine costs | By design: imported calibration feeds the **validation checklist** expected values; the engine still runs `calibrationDefaults`. See `docs/EXPERIMENT-METHODOLOGY.md` §6. |
| Changing the adapter did not change CPU cost | Adapter `cpuCostPerPacket`/`nominalMbps` are registry display values, not wired into run costs; routed cost comes from firmware-uplink calibration constants. |
| Activity report is empty after a page reload | Runs are in-memory by design; exports (`export JSON/CSV/Markdown`) are the way to keep a report. Rerun on the activity page. |
| Activity report disappeared after editing a device or the uplink rate | By design: device and bandwidth edits clear stale results so a report always belongs to the project state that produced it. Rerun. |
| `no IoT devices in managed zones — add a device first (devices page)` | Activity scope is role `iot` devices in `guest`/`trusted`/`mgmt`; the ESP32 router and external hosts are excluded. Add a device or move one in. |
| Activity says "within capacity" but the router is modeled as slow | Two ceilings: `sim.uplinkMbps` (link rate) and the 5–15 Mbps routed-throughput `estimate`. Both are shown; 2.6 Mbps of demand saturates neither. |
| Compromised device's activity is still `allowed` | Default-ALLOW with no deny rules — that is the finding. Quarantine the device (incident page) or add rules, then rerun. |
| Deep link `?run=activity` did not run | The run executes once on load in "use device states" mode; `&run=activity-normal` / `&run=activity-compromised` force a mode. On reload it runs again — it is a normal deterministic run, documented in the user guide. |

## 8. Design kit checks fail

| Capability from `docs/STYLE.md` §7 | Symptom | Fix |
| --- | --- | --- |
| Tag structure | `mismatch: <tag> at … closed by …` | Fix the markup in `ui-demo.html`; the parser reports both positions. |
| Inline script | `node --check` syntax error | Fix the inline `<script>`; keep exactly one block. |
| Token drift | Non-empty `drift` map | Copy the app's `:root` value into `.t19` (app is authoritative), or update both deliberately. Note the two known non-token deviations: kit-only `--font-ui` / `--node` / `--rowline` / `--sideon` and app-only `--mono`, plus the shell grid (kit 248 px vs app 320 px right pane) and statusbar text color (`#06140f` kit vs `#06231a` app). |

## 9. First-look map: symptom → test suite

| Area | Suite that pins the behavior |
| --- | --- |
| Pipeline verdicts, NAT, conntrack, DNAT, rate limits | `src/engine/engine.test.ts` |
| Attack scenario outcomes | `src/engine/attacks.test.ts` |
| ACL dialects and line format | `src/engine/firewall.test.ts` |
| Flow generation, states, compromise plan | `src/engine/traffic.test.ts` |
| RAM/tx/CPU model and injections | `src/engine/resources.test.ts` |
| Calibration parsing and validation checklist | `src/engine/calibration.test.ts` |
| Experiment runner, compare, exports | `src/engine/experiment.test.ts` |
| Incident lifecycle and quarantine | `src/engine/incident.test.ts` |
| Activity planning, accounting, notes | `src/engine/activity.test.ts` |
| Device add/remove, addressing, cleanup | `src/storage/deviceOps.test.ts` |
| File format, checksum, validation | `src/storage/project.test.ts` |
| Pages render | `src/app/app.smoke.test.tsx` |

When a symptom is not in this table, run `npx vitest run -t "<keyword>"` —
the test names are descriptive enough to locate the pinning behavior.
