# Firmware mapping

Maps the four firmware profiles defined in `src/registry/profiles.ts` (ids
verified at `profiles.ts:3`) to the ESP-IDF/lwIP features they require and to
the behavior the simulation enforces. Profile facts are registry data; the
engine reads the profile at construction (`src/engine/engine.ts:72-78`) and
labels every result from a hypothetical profile "not implemented on hardware"
(`src/engine/engine.ts:285`).

## Profile table

| id | name | uplink | ACL dialect | Default policy | DNS sinkhole | Client isolation | On hardware | Management channels | NAPT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `stock-eth` | esp32_nat_router — Ethernet uplink (WT32-ETH01 target) | `ethernet` | `stock-4list` | `allow` | no | no | yes | web UI, serial console, TCP remote console, mDNS, MQTT, MCP bridge, OTA | 2048 (`estimate`) |
| `stock-wifi` | esp32_nat_router — Wi-Fi STA uplink | `wifi` | `stock-4list` | `allow` | no | no | yes | same as `stock-eth` | 2048 (`estimate`) |
| `softap-sta` | ESP-IDF `softap_sta` + NAPT (minimal baseline) | `wifi` | `none` | `allow` | no | no | yes | none | 2048 (`estimate`) |
| `target-v1` | Target design v1 (hypothetical hardening) | `ethernet` | `stateful-default-deny` | `deny` | yes (custom DNS proxy) | no | **no** — simulation only | serial | 2048 (`estimate`) |

Source: `src/registry/profiles.ts:21-74`. NAPT capacity is engine
configuration, not a measured device limit (`src/app/pages/DocsPage.tsx:81-86`).

## Per-profile mapping

### `stock-eth` — esp32_nat_router with Ethernet uplink

- ESP-IDF features required: internal EMAC driver with LAN8720 over RMII,
  Wi-Fi SoftAP for the guest network, lwIP IPv4 forwarding + NAPT, and the
  stock management surface (web UI, serial console, TCP remote console, mDNS,
  MQTT, MCP bridge, OTA).
- Hardware wiring: on WT32-ETH01 the prebuilt binary assumes PHY address 1,
  RMII clock from the PHY, PHY power GPIO16 (`src/registry/profiles.ts:112`).
  On a devkit + generic LAN8720 module, build the stock firmware with
  `idf.py menuconfig → Uplink: Ethernet (LAN8720)`: MDC GPIO23, MDIO GPIO18
  defaults; verify PHY address (0 or 1) and clock mode against the module;
  never use GPIO12 for power. Fixed RMII pins are listed in
  `docs/HARDWARE-CHECKLIST.md`.
- Simulation: `stock-4list` dialect (`src/engine/firewall.ts:124-162`);
  non-IPv4 passes unfiltered (`src/engine/engine.ts:395-402`); routed flows
  cost CPU `1.0` / airtime `0.5` (`estimate`, `src/engine/calibrationDefaults.ts`).

### `stock-wifi` — esp32_nat_router with Wi-Fi STA uplink

- Same ACL semantics and management surface as `stock-eth`; the uplink shares
  the radio, so the profile models the receive-then-forward half-duplex
  penalty (`profiles.ts:46`).
- Simulation: routed flows cost CPU `2.4` / airtime `0.8` (`estimate`).

### `softap-sta` — official minimal baseline

- ESP-IDF `examples/wifi/softap_sta` + NAPT: pure forward/NAT with no
  filtering and no management surface (`profiles.ts:48-60`).
- Simulation: dialect `none`; the engine's `evaluateEsp32Local` path emits
  "baseline softap_sta + NAPT: no filtering of any kind" and allows
  (`src/engine/engine.ts:387-393`).

### `target-v1` — hypothetical hardening design (simulation only)

- Intended additions over stock (future work, not implemented on hardware):
  a stateful 5-tuple filter at the `netif` hook, per-device egress allowlists,
  a DNS proxy/sinkhole, and serial-only management (spec §18).
- Simulation enforcement: `evaluateStatefulRules` with default-deny
  (`src/engine/firewall.ts:98-122,164-177`); device egress allowlists
  (`vendor-only` / `block-all`) apply only under `stateful`
  (`src/engine/policy.ts:17-41`; `src/engine/engine.ts:655-673`);
  management probes are denied with matched rule `target:mgmt-serial-only`
  (`src/engine/engine.ts:404-408`).
- Every result from this profile carries the label "not implemented on
  hardware" (`src/engine/engine.ts:285`; `src/app/pages/HardwarePage.tsx:276-280`).

## lwIP build options and their simulation counterparts

The stock build's lwIP flags (spec §18, restated in
`src/app/pages/DocsPage.tsx:75-80`):

| Flag | What it provides in the real build | Simulation counterpart |
| --- | --- | --- |
| `LWIP_IP_FORWARD` | IP forwarding between netifs | Router branch of the pipeline: `src/engine/routing.ts`, `src/engine/engine.ts:369-373` |
| `LWIP_IPV4_NAPT` | IPv4 NAPT | `NaptTable` (`src/engine/nat.ts:25-91`), guest and upstream tables (`src/engine/engine.ts:82-83`) |
| `LWIP_IPV4_NAPT_PORTMAP` | Port mapping | `PortForwardModel` + DNAT chain (`src/engine/model.ts:137-147`; `src/engine/engine.ts:457-579`) |
| `LWIP_L2_TO_L3_COPY` | L2→L3 copy path that makes forwarded frames visible to lwIP | Visibility model: routed frames `visibleToFirewall: true`, relayed frames `not-enforceable` (`src/engine/visibility.ts:11-67`) |

## Stock ACL list mapping

The stock firmware's 4 lists are modeled in `StockAclModel`
(`src/engine/model.ts:121-126`). Their evaluation status in this engine:

| List | UI label | Simulation evaluation |
| --- | --- | --- |
| `guestToUplink` | guest → uplink | evaluated — outbound (`src/engine/firewall.ts:173-176`) |
| `uplinkToGuest` | uplink → guest | evaluated — inbound DNAT (`src/engine/engine.ts:501-504`) |
| `guestToGuest` | guest → guest | not modeled — Wi-Fi driver relays it (`src/app/pages/RulesPage.tsx:21`) |
| `uplinkLoop` | uplink → uplink | not consulted by this engine (`src/app/pages/RulesPage.tsx:22`) |

## Why L2-relayed traffic is never filtered

The stock firmware enforces its ACL by wrapping `netif->input` /
`netif->linkoutput` hooks (stock `netif_hooks.c`, spec §18). Client-to-client
frames on the SoftAP are relayed inside the closed-source Wi-Fi library and
never reach lwIP, so they never pass the hook. This is the same reason the
feature request for client isolation (`espressif/esp-idf` issue #13781) was
closed `not_planned`. The simulation encodes the consequence, not the
mechanism: `classifyFlow` returns `guest-L2-peer`, `visibleToFirewall: false`,
`enforcementPoint: wifi-driver` (`src/engine/visibility.ts:37-45`).

## What stock firmware cannot do

- Stateless ACL only — 4 lists, first-match, destination address/port, IPv4
  only; default-ALLOW; non-IPv4 passes unfiltered (`profiles.ts:33`;
  `src/engine/engine.ts:395-402`).
- No client isolation (see the note below).
- No DNS blocklist — only a "custom DNS server" setting for DHCP clients
  (spec §3.3).
- No local-input filtering: guest clients can reach the ESP32 management
  surface because the 4 lists cover forwarded traffic only
  (`src/engine/engine.ts:410-415`).
- No per-source-device blocking from incident response
  (`src/engine/engine.ts:218-255`).

## What the target design would add (future work)

A stateful 5-tuple filter at the `netif` hook, egress allowlists, a DNS proxy
for sinkholing plain DNS, and a hardened serial-only management surface (spec
§18). The repository implements a simplified simulation of these behaviors
under `target-v1` only, labeled "not implemented on hardware" wherever results
are shown or exported.

## Why `eth2ap` is not an Ethernet-WAN NAT example

ESP-IDF `examples/network/eth2ap` is a pure L2 bridge with no IP stack, and
ESP-IDF `examples/network/` contains no official Ethernet-uplink NAT example;
the official minimal NAT baseline is `examples/wifi/softap_sta` + NAPT (spec
§3.3, §18). This is why the Ethernet-uplink NAT builds in this lab are based
on the community `esp32_nat_router` firmware, and why the devkit + LAN8720
path requires one custom build of it (spec §17).

## Honest note on client isolation

Client isolation is not built on the tested stock SoftAP and is not modeled in
any shipped profile — including the hypothetical `target-v1`, whose registry
entry keeps `clientIsolation: false` (`src/registry/profiles.ts:68`), matching
spec §3.3 ("still none possible on stock ESP32 Wi-Fi"). The hardware page
displays "none possible on stock ESP32 Wi-Fi" for every profile
(`src/app/pages/HardwarePage.tsx:290`). Any paper text must describe client
isolation as an unrealized constraint of the ESP32 Wi-Fi driver, not as a
feature of the target design.
