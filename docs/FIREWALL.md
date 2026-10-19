# Warden32 — The Firewall, Honestly

What the simulation's firewall actually is, what each firmware dialect can and
cannot do, and which claims the engine refuses to make. Every behavior below is
verified against `src/engine/engine.ts`, `src/engine/firewall.ts`,
`src/engine/policy.ts`, `src/engine/conntrack.ts`, `src/engine/model.ts`,
`src/registry/profiles.ts`, and the rules/incident pages of the UI, at engine
version `0.3.0`.

Guiding rule: traffic that is invisible to the enforcement point is labelled
`not enforceable` — never "blocked". Hypothetical features carry
`not implemented on hardware` wherever results are shown.

## 1. The three dialects

`FirewallModel.dialect` (`src/engine/model.ts`) is one of:

| Dialect | Firmware profile(s) | Semantics |
| --- | --- | --- |
| `stock-4list` | `stock-eth`, `stock-wifi` (esp32_nat_router) | Stateless first-match IPv4 ACL, four fixed lists, **default ALLOW**, non-IPv4 unfiltered |
| `none` | `softap-sta` (ESP-IDF `softap_sta` + NAPT) | No filtering of any kind — pure forward/NAT, no management surface |
| `stateful` | `target-v1` (hypothetical hardening, `not implemented on hardware`) | Stateful 5-tuple, first-match rules, default DENY, per-device egress allowlist |

The dialect is declared by the firmware profile, not chosen freely in the rule
editor: `store.tsx: applyFirmware` switches both together, and `RulesPage`
shows the dialect as read-only with the profile's ACL variant. The stateful
rule list is preserved but inert under the other two dialects.

### 1.1 Stock reality (provenance-checked)

- The stock firmware's firewall is a **stateless, first-match, 4-list IPv4
  filter** with default ALLOW; there is no connection tracking, no
  default-deny, and no source-device match (DECISIONS.md and the verified
  facts mirrored in the in-app Docs page; stock README + Firewall wiki,
  `measured`).
- **Non-IPv4 passes unfiltered**: ARP, IPv6, and other frames are not matched
  by the IPv4 lists. The engine reproduces this (label
  `non-IPv4 passes unfiltered`, provenance `measured`).
- **No client isolation**: on ESP32 SoftAP, client-to-client frames are relayed
  inside the closed-source Wi-Fi library and never reach lwIP
  (espressif/esp-idf issue #13781, closed `not_planned` — `measured`). The lab
  classifies such traffic `not-enforceable`.
- **No local-input ACL**: the four lists filter *forwarded* traffic. Traffic
  addressed to the ESP32 itself (web UI, console, MQTT, …) is delivered and the
  management surface is reachable (label `management surface reachable
  (<channels>)`, `measured`).
- **Client cap**: stock builds are modelled as degrading past roughly 8
  associated clients (RAM-budgeted, firmware-specific; the ESP32-C3 profile
  notes ~5). This figure is an `estimate` used by the hardware validation
  checklist (`src/engine/validation.ts`), not an enforcement mechanism inside
  the pipeline — the pipeline itself never rejects a client for being the 9th.
- **No DNS sinkhole**: the stock firmware only exposes a custom-DNS setting for
  DHCP clients; `dnsSinkhole` is `false` on every stock profile and only the
  hypothetical `target-v1` marks it `true` (data only — no DNS proxy is
  implemented, per DECISIONS and scope §4).

## 2. Rule model

### 2.1 Stateful rule fields (`RuleModel`, `src/engine/model.ts`)

| Field | Type | Evaluated by the engine as |
| --- | --- | --- |
| `id`, `name` | string | identity; `matchedRule` in results uses `id`, labels use `name` |
| `enabled` | boolean | disabled rules are skipped and recorded in the trace as `rule disabled` |
| `src`, `dst` | string | `any` \| device id \| IPv4 host \| CIDR; device ids match `ipv4` + `extraIps` |
| `srcZone`, `dstZone` | `ZoneId \| "any"` | compared with the evaluation context zones |
| `protocol` | `"any" \| Protocol` | exact protocol match (`TCP`, `UDP`, `ICMP`, `ARP`, `IPv6`, `OTHER`) |
| `srcPorts`, `dstPorts` | `[from, to] \| null` | inclusive range; `null` matches any port; a `null` packet port fails a non-null range |
| `inInterface`, `outInterface` | string | `any` \| interface id (`guest0`, `wan0`, …) |
| `connStates` | `ConnState[] \| null` | `null` = any; otherwise the context state must be non-null and included |
| `action` | `accept \| drop \| reject` | first match ends evaluation; `accept → allow`, others deny |
| `log` | boolean | **stored and editable, not simulated** — the engine never reads it (the rules page states this verbatim) |
| `rateLimitPerSec` | number \| null | fixed 1 s window on this rule's matched allows (see §4) |
| `description` | string | justification text, exported and shown in the UI |

Matching order inside a rule (`matchRule`): protocol, src zone, dst zone, in
interface, out interface, src ports, dst ports, conn state, src address, dst
address. The first failing check is recorded in `RuleDecision.trace` with a
human-readable reason. Default policy (`allow`/`deny`) applies only after all
enabled rules are skipped and only under the stateful dialect.

State matching note: contexts use `NEW` for forwarded traffic (`connState:
"NEW"` on the inbound path; `forcedConnState ?? "NEW"` on the outbound path),
and established flows never reach rule evaluation (conntrack bypass,
`docs/PIPELINE.md` §4.3). A rule restricted to `ESTABLISHED` therefore only
matches deliberately forced states, not ordinary repeat traffic.

### 2.2 Stock ACL entry fields (`AclEntryModel`)

`id`, `protocol` (`tcp | udp | icmp | any`), `portFrom`, `portTo` (numbers or
`null`), `target` (IPv4 host or CIDR), `action` (`allow | drop`). Four lists
exist in `StockAclModel`; the engine consults only two:

| List | Consulted where |
| --- | --- |
| `guestToUplink` | outbound policy under `stock-4list` (`evaluateFirewall`) |
| `uplinkToGuest` | inbound DNAT policy under `stock-4list` (evaluated directly in `evaluateInbound`) |
| `guestToGuest` | **never consulted** — guest-to-guest frames never reach lwIP (Wi-Fi driver relay) |
| `uplinkLoop` | **never consulted** by this engine |

The rules page renders each list as a text editor; the stock text format
carries no action token, so parsed lines become `allow` entries, and an
existing `drop` entry survives editing only while its line is left unchanged
(UI behavior, `RulesPage.tsx`).

## 3. `parseStockAclLine` behavior

Format: `<proto>/<portFrom>[-<portTo>]/<ip|subnet>` (e.g.
`tcp/8554-8554/0.0.0.0/0`, `udp/53-53/203.0.113.53`,
`tcp/443-443/203.0.113.0/24`).

| Input | Result |
| --- | --- |
| empty string or `#…` comment line | `ok: false`, error `empty or comment line` |
| fewer than three `/`-separated parts (`tcp/443`) | `ok: false`, error `expected <proto>/<port>-<port>/<ip|subnet>, got "…"` |
| protocol not in `tcp`, `udp`, `icmp`, `any`, `*` | `ok: false`, error `unsupported protocol "…"` |
| protocol `any` or `*` | entry protocol `any`; warning `stock firmware documents tcp/udp/icmp rules; other protocols are non-standard` (the `*` spelling from real ACL lines is accepted, then flagged) |
| port: single integer | `portFrom = portTo = value` |
| port range `a-b` with `a ≤ b`, both integers 0–65535 | accepted |
| more than one `-`, non-integers, out-of-range, or reversed range | `ok: false`, error `invalid port range "…"` |
| target `*` or `any` | normalized to `0.0.0.0/0` |
| target without `/` | validated with `parseIPv4`; invalid → `ok: false`, error `invalid address "…"` |
| target with `/` | CIDR targets are reassembled from all parts after the port field, so `tcp/443-443/203.0.113.0/24` parses; validated via subnet math; invalid → `ok: false`, error `invalid subnet "…"` |
| valid input | entry with `action: "allow"`, `ok: true` |

`formatStockAclEntry` round-trips the same syntax (`any` targets are formatted
as `0.0.0.0/0`, port-less entries as `0-65535`).

### 3.1 Stock ACL evaluation (`evaluateStockAclList`)

- First match wins in list order; disabled-entry bypass does not exist for
  stock lists (entries have no `enabled` flag).
- Protocol matches when the entry is `any` or equals the packet protocol
  (case-insensitive).
- Port check: when the entry has a non-null range **and** the packet has a
  destination port, out-of-range entries are skipped; a packet without a port
  (`null`) skips the range check and can match a port-constrained entry. This
  is a deliberate simplification, documented here.
- Address: `inSubnet(remoteIp, target)` — host targets behave like `/32`, and
  `0.0.0.0/0` matches everything.
- No match at all → `action: allow` with label
  `default policy — stock ACL allows when no rule matches`; the outbound path
  additionally adds the result label `no egress filtering on stock — default allow`.

## 4. Egress filtering and rate limiting

**Egress filtering exists only under the stateful dialect.** In
`evaluateOutbound`:

- `stock-4list`: the stateful rule list is inert; the stock `guestToUplink`
  list is consulted and the default is allow (the honest label above is
  added).
- `none`: `evaluateFirewall` returns allow — no filtering at all.
- `stateful`: `evaluateDeviceEgress(src.egressPolicyId, …)` runs **before** the
  firewall rules:
  - `allow-all` → allow (`egress:allow-all`, label
    `device egress: allow all`);
  - `block-all` → drop (`egress:block-all`, label
    `device egress: block all`);
  - `vendor-only` → allow only when the destination address exactly equals a
    vendor endpoint IP, the protocol matches, and the port is listed (or the
    endpoint declares no ports, or the flow has no port); otherwise drop with
    label `device egress: vendor-only — <ip> is not a vendor endpoint`.
  - When the device policy allows, the stateful rule list still runs; a rule
    match can drop the flow. If no rule matches, the device-policy decision is
    the fallback instead of the global default.

**Rate limiting** (`rateLimitPerSec`) is a per-rule fixed 1-second window
counter held in the engine and advanced only by the `SimClock` (deterministic).
It is consulted only when the decision is `allow` and a stateful rule matched,
and only on the outbound path. On exceed: verdict `denied`, reason
`rate limit: <rule> allows N packet(s)/s — excess dropped`, label
`rate limit N/s enforced`, event `firewall` warn with provenance `assumption`.
A rate limit never applies to the inbound DNAT path or esp32-local traffic.

## 5. Quarantine and `addBlockRule` per dialect

### 5.1 Quarantine

`engine.setQuarantine(deviceId, boolean)` sets `DeviceModel.quarantined` and
emits an `incident` event. In the pipeline, any flow whose source **or**
destination is quarantined is dropped with `matchedRule: "incident:quarantine"`
and `connState: "INVALID"`, with these honesty labels:

| Firmware dialect | Label added |
| --- | --- |
| anything other than `stateful-default-deny` (stock and `none`) | `incident response: device quarantined` + `quarantine is a simulation response — stock firmware cannot isolate a client (no isolation feature)` |
| `stateful-default-deny` (`target-v1`) | `incident response: device quarantined` + `quarantine is enforceable in the target design (not implemented on hardware)` |

Two nuances to be aware of:

- The quarantine check runs **before** the L2-visibility exit, so a quarantined
  device's client-to-client frames are also stopped *in the simulation*; the
  stock label is what tells the reader this cannot happen on real hardware.
- On `target-v1` the label both asserts enforceability and denies hardware
  availability, because `target-v1` is simulation-only.

### 5.2 `addBlockRule(deviceId)`

| Dialect | Result |
| --- | --- |
| `stateful` | `ok: true`. Inserts (at the top, replacing any previous rule with the same id) `incident-block-<deviceId>`: name `block <name> (incident response)`, `src = <device id>`, `dst = any`, protocol `any`, action `drop`, `log: true`, description `Inserted by incident response at <ms> ms; source <ip>.` Emits an `incident` warn event. |
| `stock-4list` | `ok: false`, message verbatim: `the stock 4-list ACL matches destination address/port, not the source device — it cannot block a guest host; remove or disable the client instead` |
| `none` | `ok: false`, message: `no rule dialect is active — add a stateful baseline first` |

The refusal is the honest core of the stock story: the stock ACLs cannot match
a source host, so no rule can "block the compromised camera" on real stock
firmware. The incident page displays the refusal verbatim.

## 6. Port forwards and the firewall

`PortForwardModel`: `id`, `name`, `enabled`, `routerId`, `externalPort`,
`protocol` (`TCP | UDP`), `internalDeviceId`, `internalPort`, `note`.

- A forward matches only when `enabled`, on the given router, with the exact
  `externalPort` and protocol (`findForward`).
- Inbound evaluation walks the double-NAT chain: the **upstream home router**
  forward must exist for the flow's destination port; then the **ESP32** must
  have a forward whose `externalPort` equals the upstream forward's
  `internalPort`. A missing forward on either router is a boundary drop with a
  router-specific reason; the upstream case also adds the label
  `double NAT — an inbound port-forward is required on both routers`.
- **A forward implies allow unless an explicit rule blocks it.** After the
  chain exists, the engine evaluates the inbound ACL: `uplinkToGuest` under
  `stock-4list`, otherwise the stateful list (or the `none` dialect's
  no-filtering allow). A deny decision produces `denied` with reason
  `port-forward exists but <rule label> blocks it`. Otherwise the flow is
  allowed with `matchedRule: "port-forward:explicit"` when no rule matched.
- Allowed inbound flows add the label
  `inbound port-forward exposes an internal service to the internet` plus the
  forward's own `note` (e.g. the sample camera forward's
  "Exposes the camera RTSP service to the internet — attack surface increase").
- A DNAT conntrack entry is created with the 120 s DNAT timeout; its replies
  return through the same table (`conntrack:established`) without re-running
  policy. See `docs/PIPELINE.md` §3.4 for the full order.

## 7. Verdicts and labels (verbatim from `engine.ts`)

### 7.1 Verdicts

| Verdict | Meaning | Typical causes |
| --- | --- | --- |
| `allowed` | Forwarded/delivered under the active dialect | stock default-allow, matching accept rule, egress allowlist match, explicit port forward, established/return traffic, non-IPv4 delivery |
| `denied` | Explicit refusal by policy, incident response, state, or rate limit | stateful default-deny, device egress block, `reject`/`drop` rule, `incident:quarantine`, `conntrack:invalid`, inbound ACL block, `rate limit` |
| `dropped` | No path or resource to carry the flow | offline device, spoof check, NAT boundary, NAPT/conntrack table full, RAM/TX exhaustion, no route, unreachable upstream |
| `not-enforceable` | The enforcement point never sees it | guest-to-guest relay, 802.11 management frames |

`drop` and `reject` rule actions both produce verdict `denied`; the operational
difference (silent discard vs error response) is visible only through the
matched rule's action label, not through a separate verdict value.

### 7.2 Label identifiers (`FlowResult.labels`, verbatim strings)

| Label | Emitted when |
| --- | --- |
| `not implemented on hardware` | `target-v1` result, any outcome |
| `incident response: device quarantined` | quarantined endpoint |
| `quarantine is a simulation response — stock firmware cannot isolate a client (no isolation feature)` | quarantine under stock/`none` |
| `quarantine is enforceable in the target design (not implemented on hardware)` | quarantine under `target-v1` |
| `client isolation unavailable on ESP32 Wi-Fi` | invisible L2 traffic |
| `spoofed source rejected at ingress` | spoof check |
| `non-IPv4 passes unfiltered` | ARP/IPv6/OTHER delivered to the router |
| `management surface reachable (web UI, serial console, TCP remote console, mDNS, MQTT, MCP bridge, OTA)` | stock IPv4 traffic to the router (channel list is profile data) |
| `double NAT — an inbound port-forward is required on both routers` | missing upstream forward |
| `inbound port-forward exposes an internal service to the internet` | successful inbound DNAT chain |
| forward `note` text (project data) | forward with a note, successful chain |
| `invalid state dropped under stateful filtering` | stateful INVALID drop |
| `no egress filtering on stock — default allow` | stock fallback allow |
| `rate limit <N>/s enforced` | rate limit exceeded |
| `double NAT — upstream home router translates again` | successful outbound NAPT chain |
| `NAPT table exhausted` | NAT port table full |
| `connection table exhausted` | conntrack full |
| `no route — routing table has no path` | route lookup miss |
| `no route — destination unreachable from the upstream network` | upstream reachability failure |
| `tx queue full — buffer exhaustion (estimate)` | TX queue overflow |
| `RAM exhausted — allocation refused` | heap model exhausted |
| `CPU load estimate above 100% — real firmware would add latency, not drop (estimate)` | CPU window over budget (label only, never a drop) |

Non-rule `matchedRule` identifiers used by the engine:
`incident:quarantine`, `ingress:source-check`, `conntrack:established`,
`conntrack:invalid`, `port-forward:explicit`, `target:mgmt-serial-only`,
`egress:vendor-only`, `egress:allow-all`, `egress:block-all`.

## 8. What this firewall will not claim

- Guest-to-guest attacks are never "blocked" on stock — the lab's flagship
  honest result is that they succeed and are invisible to lwIP.
- Stock has no egress filtering; C2 traffic is allowed by default and the
  engine says so with a label rather than pretending a rule exists.
- The stateful dialect, device egress allowlists, the DNS sinkhole data and
  quarantine enforcement are all `not implemented on hardware`; every result
  under `target-v1` carries the label.
- The ~8-client figure and all CPU/airtime/RAM costs are `estimate` values
  pending hardware calibration, and are marked as such in results and exports.
