# Warden32 — Packet Pipeline

Exact evaluation order of `SimEngine.submitFlow` (`src/engine/engine.ts:272`).
This document is written against engine version `0.3.0`; if code and document
disagree, the code is authoritative.

Scope: one submitted `Flow` (the simulation's unit of routed intent — a flow
tuple, not a raw packet) is carried through visibility classification, safety
checks, path branching, policy, address translation, connection tracking, route
lookup, and resource admission, and ends in exactly one `FlowResult` with a
verdict and a collected `SimEvent` list.

## 1. Order of evaluation (summary)

```
classify / visibility
  → offline check
  → quarantine
  → L2-visibility exit (not enforceable)
  → spoof check
  → branch: esp32-local | inbound (internet/upstream src) | outbound
      esp32-local: dialect none → non-IPv4 → target stateful deny → stock management surface
      inbound:     conntrack return → port validity → upstream forward → ESP32 forward
                   → target offline check → ACL → RAM → DNAT conntrack create → tx
      outbound:    INVALID (stateful only) → conntrack established → DNAT reply
                   → policy (device egress only under stateful) → rate limit
                   → NAPT double NAT → RAM → conntrack create
                   → route lookup → upstream reachability → tx
  → finalize (verdict + reason + NAT chain + costs + labels + events)
```

Every stage below is implemented in `SimEngine` unless a module is named.
"Event categories" reference the `EventCategory` union in `src/engine/types.ts`;
the log itself lives in `src/engine/events.ts`.

## 2. Stage table

| # | Stage | Implementation | Emitted event categories |
| --- | --- | --- | --- |
| 1 | Device resolution + classification | `submitFlow` + `visibility.ts: classifyFlow(src.zone, dst.zone, dst.isRouter, protocol)` | `pipeline` (scope + reason, provenance `measured`) |
| 2 | Firmware honesty label | `FIRMWARE_PROFILES[…]` via `implementedOnHardware` | none (adds label `not implemented on hardware`) |
| 3 | Offline check | `submitFlow` (`!src.online \|\| !dst.online`) | `pipeline` |
| 4 | Quarantine | `submitFlow` + `DeviceModel.quarantined` | `incident` |
| 5 | L2-visibility exit | `submitFlow` (`!cls.visibleToFirewall`) | `wifi` |
| 6 | Ingress source (spoof) check | `submitFlow` + `Flow.spoofedSrcIp` | `attack` |
| 7 | Branch selection | `submitFlow` (`dst.isRouter` → local; src zone `internet`/`upstream` → inbound; else outbound) | none |
| 8 | esp32-local path | `evaluateEsp32Local` | `firewall` |
| 9 | Inbound conntrack return | `evaluateInbound` + `connections.lookupReturn` | `conntrack` |
| 10 | Inbound port validity | `evaluateInbound` (port null or non-TCP/UDP) | `conntrack` |
| 11 | DNAT forward chain | `evaluateInbound` + `findForward` (upstream router, then ESP32) | `nat` |
| 12 | Inbound ACL | `firewall.ts: evaluateStockAclList(uplinkToGuest)` or `evaluateFirewall` | `firewall` |
| 13 | Inbound RAM admission | `ramAllocationBlocked` | `resource` |
| 14 | Inbound DNAT connection create | `conntrack.create(kind "dnat")` | `conntrack` |
| 15 | Exposure warning | `evaluateInbound` | `firewall` |
| 16 | Outbound INVALID state | `evaluateOutbound` (stateful dialect only) | `conntrack` |
| 17 | Outbound established bypass | `connections.lookupForward` → `forwardOutbound` | `conntrack` |
| 18 | Outbound DNAT reply | `connections.lookupReturn` with `kind === "dnat"` | `conntrack` |
| 19 | Policy / egress | `firewall.ts: evaluateFirewall`, `policy.ts: evaluateDeviceEgress` (stateful only) | `firewall` |
| 20 | Rate limit | `rateLimitFor` (1 s fixed window per rule) | `firewall` |
| 21 | NAPT double NAT | `translateOutboundNat` → `nat.ts: NaptTable.translateOutbound` ×2 | `nat` |
| 22 | Outbound RAM admission | `ramAllocationBlocked` | `resource` |
| 23 | Outbound connection create | `conntrack.create(kind "outbound")` | `conntrack` |
| 24 | Route lookup | `routeLookup` → `routing.ts: lookupRoute` over `effectiveRoutes()` | `routing` |
| 25 | Upstream reachability | `upstreamReachability` | none (appears in final reason) |
| 26 | TX queue / resource admission | `txAdmission` → `ResourceTracker.enqueue` | `resource` (only on overflow) |
| 27 | Finalize | `finalize` | `pipeline` (verdict line) |

## 3. Stage detail

### 3.1 Classification and pre-checks

1. `classifyFlow` produces `{ scope, visibleToFirewall, enforcementPoint, reason }`:
   - destination is the router itself (`dst.isRouter`) → `esp32-local`, visible, `l3-firewall`;
   - protocol `OTHER` (802.11 management placeholder) → `wifi-management`, invisible, `wifi-driver`;
   - guest → guest → `guest-L2-peer`, invisible, `wifi-driver` (client frames
     are relayed inside the closed-source Wi-Fi library; ESP-IDF issue #13781
     closed `not_planned` — measured);
   - guest → internet/upstream or internet/upstream → guest → `internet-routed`,
     visible, `l3-firewall`;
   - any remaining zone pair → `lan-routed`, visible, `l3-firewall`.
2. If the firmware is `target-v1`, label `not implemented on hardware` is added
   to every result; `counters.flows` increments (all engines, every path).
3. **Offline**: if either endpoint is offline, the flow is `dropped`
   (`device offline`, `connState: null`) and evaluation stops. No events other
   than the `pipeline` warning.
4. **Quarantine**: if either endpoint is quarantined, the flow is `dropped`
   with `matchedRule: "incident:quarantine"`, `connState: "INVALID"`, and the
   honesty labels described in `docs/FIREWALL.md`. This check runs *before* the
   visibility exit — a quarantined device's L2 peer traffic is also stopped in
   the simulation, and the label states that stock firmware cannot actually
   isolate a client.
5. **L2-visibility exit**: if `!visibleToFirewall`, the flow ends as
   `not-enforceable`, `cpuCost: 0`, `airtimeCost` = calibration
   `airtimeL2Relay` (default 1.0, `estimate`), label
   `client isolation unavailable on ESP32 Wi-Fi`, `connState: null`. No policy,
   NAT, or route code runs.
6. **Spoof check**: if `Flow.spoofedSrcIp` is set and differs from the source
   device's address, the flow is `dropped` with `matchedRule:
   "ingress:source-check"`, `connState: "INVALID"`, label
   `spoofed source rejected at ingress`. L2 relayed frames never reach this
   check (stage 5 exits first) — consistent with the no-isolation reality.

### 3.2 Branching

- Destination is the router (`dst.isRouter`) → `evaluateEsp32Local`.
- Source zone is `internet` or `upstream` → `evaluateInbound`.
- Everything else (guest, trusted, mgmt sources) → `evaluateOutbound`.

### 3.3 esp32-local path (`evaluateEsp32Local`)

| Dialect | Behavior |
| --- | --- |
| `none` (softap-sta) | `allowed` — "minimal baseline profile — pure forward/NAT, no firewall configured" (`firewall` info, datasheet) |
| any, non-IPv4 (`ARP`/`IPv6`/`OTHER`) | `allowed` — stock ACLs match IPv4 only; frames pass unfiltered; label `non-IPv4 passes unfiltered` (`firewall` warn, measured) |
| `stateful-default-deny` | `denied` — target design v1, management serial-only; `matchedRule: "target:mgmt-serial-only"` (`firewall` warn, assumption) |
| `stock-4list` (IPv4) | `allowed` — traffic to the router is not matched by the four *forwarded-traffic* ACL lists; label `management surface reachable (<channels>)` (`firewall` warn, measured) |

The local path then runs TX admission before finalizing.

### 3.4 inbound path (`evaluateInbound`, src zone internet/upstream)

1. **Return traffic**: `connections.lookupReturn(protocol, srcIp, dstIp, dstPort)`
   matches the reverse tuple of any entry. On match: confirm the entry
   (→ ESTABLISHED), `allowed` with `matchedRule: "conntrack:established"`,
   `airtimeCost: 0`.
2. **Port validity**: `dstPort === null`, or protocol is not TCP/UDP →
   `dropped` ("cannot traverse NAPT"), `connState: "INVALID"` (`conntrack`
   warn).
3. **Upstream forward**: `findForward(gateway.id, flow.dstPort, protocol)`
   requires an *enabled* forward whose `externalPort` equals the destination
   port. Missing → `dropped`, label
   `double NAT — an inbound port-forward is required on both routers`, reason
   "NAT boundary: upstream home router drops <publicIp>:<port>" (`nat` warn).
4. **ESP32 forward**: `findForward(router.id, gatewayForward.internalPort,
   protocol)`. Missing → `dropped` ("NAT boundary: <router> has no DNAT mapping
   for port …") (`nat` warn).
5. **Target online**: the forward's internal device must be online, else
   `dropped`.
6. **ACL**: under `stock-4list`, `evaluateStockAclList(stockAcl.uplinkToGuest,
   protocol, espForward.internalPort, srcIp)`; otherwise
   `evaluateFirewall` with a context of `inInterface: "wan0"`,
   `outInterface: "guest0"`, `connState: "NEW"`, destination = internal
   device address/port. A `drop`/`reject` decision → `denied` ("port-forward
   exists but … blocks it"), `connState: "INVALID"` (`firewall` warn).
   Matched rule ids increment the hit counter.
7. **RAM admission** (`ramAllocationBlocked`) → `dropped` when the RAM model
   reports exhaustion.
8. **DNAT connection create**: `connections.create(..., kind "dnat", now, {
   dstIp: internal, dstPort: internalPort })` with the DNAT timeout (120 s).
   Table full → `dropped`, label `connection table exhausted`.
9. **Labels and events**: `inbound port-forward exposes an internal service to
   the internet`, plus the forward's `note` when present; `conntrack` info for
   the DNAT; `firewall` warn that the forward is explicit inbound exposure.
10. **TX admission**, then `allowed` with `matchedRule =
    decision.matchedRuleId ?? "port-forward:explicit"` and a two-hop NAT chain:
    `<gateway>: publicIp:port → wanIp:internalPort` then
    `<router>: wanIp:externalPort → internalIp:internalPort`. `route` is a note
    ("NAT chain resolves to <internal> on the guest network"), `connState:
    "NEW"`.

### 3.5 outbound path (`evaluateOutbound`)

1. **INVALID state (stateful dialect only)**: `Flow.forcedConnState ===
   "INVALID"` while `dialect === "stateful"` → `denied` before any rule runs,
   `matchedRule: "conntrack:invalid"`, label
   `invalid state dropped under stateful filtering`. Under `stock-4list` the
   same flow falls through to stock ACL evaluation and is allowed by default.
2. **Established bypass**: `connections.lookupForward(protocol, srcIp,
   srcPort, dstIp, dstPort)`; a hit confirms the entry and delegates to
   `forwardOutbound`, which re-runs NAT translation, route lookup, and TX
   admission but **never evaluates policy rules**. `matchedRule:
   "conntrack:established"`, `connState: "ESTABLISHED"`.
3. **DNAT reply**: `lookupReturn` with `kind === "dnat"` → `allowed` as the
   reverse path of a port-forwarded connection (`connState: "ESTABLISHED"`,
   `airtimeCost: 0`).
4. **Policy**:
   - `stock-4list`: `evaluateFirewall` → `evaluateStockAclList(
     stockAcl.guestToUplink, protocol, dstPort, dstIp)`, default allow; when the
     default applies (no match) the label `no egress filtering on stock — default
     allow` is added.
   - `none`: `evaluateFirewall` returns allow ("dialect none — no filtering
     configured").
   - `stateful`: `evaluateDeviceEgress(src.egressPolicyId, …)` runs first. A
     device-policy `drop` decides immediately; a device-policy `allow` is used
     only as the fallback label when no firewall rule matches.
   - Skipped rules, matched rules, and the fallback default policy are captured
     in `RuleDecision.trace`; every matching rule id increments its hit counter.
5. **Rate limit**: consulted only when the decision is `allow` *and* a rule
   matched, and only on this outbound path (see §4.4).
6. **NAPT double NAT**: `translateOutboundNat` translates the flow once on the
   guest NAPT table (source → ESP32 WAN address) and once on the upstream
   table (source → public address). `NatTableFullError` → `dropped` ("NAPT
   table full — no free translation port"), label `NAPT table exhausted`
   (`nat` warn). On success a two-hop chain is built and label `double NAT —
   upstream home router translates again` is added.
7. **RAM admission**, then **connection create** (`kind "outbound"`, translated
   `srcIp`/`srcPort`), table full → `dropped`, label
   `connection table exhausted`.
8. **Route lookup**: `routeLookup(dstIp)` → `lookupRoute` over
   `effectiveRoutes()` (see §5). No match → `dropped`
   (`no route to <ip>: <reason>`), label `no route — routing table has no path`
   (`routing` info still emitted with the reason).
9. **Upstream reachability**: internet destinations are reachable by the
   default route; upstream-LAN destinations are reachable on the same segment
   after NAT; any other zone is unreachable → `dropped`, label
   `no route — destination unreachable from the upstream network`. A down
   interface of that zone is named in the reason when known.
10. **TX admission**, then `allowed` with the composite reason
    `"<scope reason>; <policy label>; <route reason>; upstream: <reason>"`.

### 3.6 Finalize

Every path returns through `finalize`, which appends one `pipeline` event
(`ok` for `allowed`, `warn` otherwise, provenance `estimate`) and returns
`FlowResult { flow, scope, visibleToFirewall, enforcementPoint, verdict,
reason, matchedRule, natChain, cpuCost, airtimeCost, labels, events, connState,
route }`.

## 4. Connection tracking semantics

Implemented in `src/engine/conntrack.ts`; the engine owns one `ConnTrackTable`
sized by `project.resources.conntrackCapacity` (sample: 2048).

### 4.1 Entry identity and states

- Identity is the forward 5-tuple `(protocol, srcIp, srcPort, dstIp, dstPort)`
  for `kind: "outbound"`; DNAT entries additionally carry the translated
  destination tuple.
- States: `NEW`, `ESTABLISHED`, `INVALID`, `EXPIRED` (and `RELATED` exists in
  the type union but is not produced by the engine).
- `create` reuses an existing forward entry (increments `packets`, confirms
  NEW→ESTABLISHED) instead of allocating a second row; returns `null` when the
  table is at capacity.
- `confirm` sets `ESTABLISHED` and switches the timeout to established.
- `expire(now)` removes entries where `now - lastSeenAt > timeoutMs` and
  returns them with state `EXPIRED`; `SimEngine.advanceTo` calls it and emits a
  `conntrack` info event per expired entry (provenance `estimate`).
- `markClosing` and `TCP_CLOSING_TIMEOUT_MS` are defined in `conntrack.ts` but
  are not invoked by the engine today: no submitted flow can enter a closing
  state, so the closing timeout is currently unreachable in practice.

### 4.2 Timeouts

| Entry | Timeout | Provenance |
| --- | --- | --- |
| TCP `NEW` (also the base for non-UDP protocols) | 10 s | estimate (standard value) |
| TCP `ESTABLISHED` | 300 s | estimate |
| TCP closing (`TCP_CLOSING_TIMEOUT_MS`) | 10 s | estimate — constant defined; not driven by the current engine (see §4.1) |
| UDP (NEW and established) | 30 s | estimate |
| DNAT entries (`kind: "dnat"`, any protocol) | 120 s | estimate |

`docs/DECISIONS.md` (M3) records these as deliberately explicit, standard
values that remain `estimate` provenance until hardware calibration.

### 4.3 Established flows bypass rules

A flow matching an existing outbound entry is forwarded via `forwardOutbound`
without re-evaluating device egress or firewall rules — the same operating
model as production conntrack/NAT firewalls (decision log M3). Return traffic
is matched by `lookupReturn` (reverse tuple, any entry kind) in the inbound
path; a DNAT reply outbound is matched by `lookupReturn` restricted to
`kind === "dnat"`.

### 4.4 INVALID handling and rate limits

- **INVALID**: only `Flow.forcedConnState === "INVALID"` under the `stateful`
  dialect is dropped pre-rules (`conntrack:invalid`). Stock and `none` dialects
  do not consult connection state; a forced INVALID flow is evaluated normally.
- **Rate limits**: `RuleModel.rateLimitPerSec` is a fixed 1-second window
  counter kept per rule id in the engine (`RATE_WINDOW_MS = 1000`). The window
  is only touched when a rule matched with action `accept` on the outbound
  path; windows advance only with the `SimClock` (deterministic). Exceeding the
  limit turns the flow into `denied` with reason
  `rate limit: <rule> allows N packet(s)/s — excess dropped`, label
  `rate limit N/s enforced` (`firewall` warn, assumption). The counter is
  never consulted on the inbound DNAT path or the esp32-local path.

## 5. NAT/NAPT semantics used by the pipeline

- `NaptTable` (per router): deterministic port allocation from 49152 upward,
  wrapping at 65535; per-flow mapping keyed by the original tuple; capacity
  checked before allocation; `translateOutbound` reuses an existing mapping and
  increments its packet count.
- The guest table uses `project.resources.naptCapacity`; the upstream table is
  constructed with the `NaptTable` default capacity (2048). The resource
  snapshot reports the sum of both table sizes.
- Outbound translation is applied *after* policy and *before* conntrack
  creation, so a flow denied by policy never consumes a NAT port or connection
  row. This ordering is asserted in `engine.test.ts`.
- Inbound translation is state-driven: the DNAT chain is only built when both
  routers have enabled forwards and the ACL permits the flow.

## 6. Routing and reachability

- `effectiveRoutes()` derives connected routes at runtime from every interface
  that is up and has an address (`connectedRouteFor`), then appends the
  project's persisted routes (`connected`, `default`, `static`). Down
  interfaces and disabled routes are excluded and recorded as skip reasons in
  the lookup candidate list.
- `lookupRoute` returns the longest-prefix match; reasons distinguish
  "no route matches destination", "routing table is empty", and the connected
  vs default/static forms.
- Upstream reachability is a separate check after the ESP32-local route lookup:
  it models the fact that the ESP32 can route a flow into the WAN while the
  upstream network still has no path back to logical zones such as `trusted`
  or `mgmt` (`upstreamReachability`, reason names a down interface when
  applicable).

## 7. Resources and admission

- `ResourceTracker.enqueue` records CPU and airtime cost samples in 1 s windows
  and increments TX queue depth. Queue depth above `txQueueLength` → flow
  `dropped` with label `tx queue full — buffer exhaustion (estimate)` and a
  `resource` warn event. `advanceTo` drains the queue (50 entries/s) and prunes
  the windows.
- CPU load above 100 % adds the label
  `CPU load estimate above 100% — real firmware would add latency, not drop (estimate)`
  but never drops the flow — an explicit honesty decision (real firmware slows
  down rather than losing packets at that point).
- RAM exhaustion is checked before connection allocation in the outbound and
  inbound paths; the flow is `dropped` with label
  `RAM exhausted — allocation refused`.

## 8. Verdict and counter mapping

| Verdict | Set by |
| --- | --- |
| `allowed` | successful esp32-local delivery, inbound DNAT chain, established/DNAT-reply traffic, and policy-allowed outbound flows after route/reachability/TX admission |
| `denied` | quarantine (`incident:quarantine`), stateful INVALID (`conntrack:invalid`), policy drop/reject, inbound ACL block, rate limit |
| `dropped` | device offline, spoofed source, NAT boundary (missing forward/port), NAPT/connection table full, RAM exhaustion, TX queue overflow, no route / unreachable upstream |
| `not-enforceable` | frames invisible to lwIP (guest-L2-peer, Wi-Fi management) |

`EngineCounters` increments exactly one of `allowed`, `denied`, `dropped`, or
`notEnforceable` per submitted flow (plus `flows`), on all paths. Note that a
quarantine drop increments `dropped`, and that `not-enforceable` frames still
increment `flows` even though they bypass policy entirely.

## 9. Determinism in the pipeline

- No stage reads wall-clock time; all timestamps come from `SimClock.now`.
- The pipeline itself contains no randomness; the only PRNG use is upstream in
  traffic flow generation (`rng.ts`, seeded per device/profile).
- NAPT port allocation and conntrack ids are deterministic functions of
  submission order.
- Given the same project, the same seed, and the same flow sequence,
  `FlowResult` values, event messages, NAT ports, and counters are identical
  across runs (reproducibility test: `src/engine/engine.test.ts`).
