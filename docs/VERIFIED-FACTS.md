# Verified facts

The Warden32 engine encodes the facts below. Each row records the repository
source that enforces or documents the fact, the provenance tag the lab assigns
to it, and the external reference recorded inside the repository. No URL is
invented here: this repository does not store URLs for these facts, so issue
numbers, upstream artifact names, study years and benchmark values are
reproduced exactly as recorded during the build (the original build brief,
which anchored these facts, is not part of this repository) and in the source
tree.

Provenance vocabulary: `measured | datasheet | paper | estimate | assumption`.
Test evidence referenced below is green under `npm test`
(vitest 5.0.5; 17 files, 144 tests; engine version `0.3.0` from
`src/storage/project.ts:7`).

## Table — verified reality facts

| # | Fact | Verified detail | Repository source | Provenance | External reference (as recorded in-repo) |
| --- | --- | --- | --- | --- | --- |
| 1 | No Wi-Fi client isolation on ESP32 SoftAP | Guest-to-guest frames are relayed inside the closed-source Wi-Fi library and never reach lwIP; there is no isolation API. The lab classifies this traffic `guest-L2-peer`, `visibleToFirewall: false`, `enforcementPoint: wifi-driver`, verdict `not-enforceable`, CPU cost 0, airtime `AIRTIME_L2_RELAY = 1.0` (`estimate`). | Spec §3.4; `src/engine/visibility.ts:37-45`; `src/engine/engine.ts:328-338`; `src/app/pages/DocsPage.tsx:38-44`; `src/app/pages/OverviewPage.tsx:5`; tests `src/engine/engine.test.ts:27-35`, `src/engine/attacks.test.ts:63-74` | `measured` | `espressif/esp-idf` issue #13781, state `not_planned` (issue number recorded; year not recorded in-repo) |
| 2 | Stock ACL semantics | Stateless, first-match ACL over 4 fixed lists (`uplinkToGuest`, `guestToUplink`, `guestToGuest`, `uplinkLoop`); default-ALLOW; matches IPv4 destination address/port only; non-IPv4 (ARP, IPv6) passes unfiltered. The engine evaluates `guestToUplink` outbound (`src/engine/firewall.ts:173-176`) and `uplinkToGuest` inbound DNAT (`src/engine/engine.ts:501-504`) only; the UI labels `guestToGuest` "not modeled — Wi-Fi driver relays it" and `uplinkLoop` "not consulted by this engine" (`src/app/pages/RulesPage.tsx:19-22`). | Spec §3.3; `src/registry/profiles.ts:33`; `src/engine/model.ts:121-126`; `src/engine/firewall.ts:124-162`; `src/engine/engine.ts:395-402,501-504`; tests `src/engine/firewall.test.ts:103-134`, `src/engine/engine.test.ts:37-41` | `measured` | martin-ger/`esp32_nat_router` README and Firewall wiki page (named in spec §3.3; no URL recorded in-repo) |
| 3 | Stock firmware has no DNS blocklist | Only a "custom DNS server" setting for DHCP clients exists. `dnsSinkhole` is `false` for `stock-eth`, `stock-wifi` and `softap-sta`; `true` only for the hypothetical `target-v1`, which is `implementedOnHardware: false`. | Spec §3.3; `src/registry/profiles.ts:28,42,55,67`; `src/app/pages/DocsPage.tsx:45-50` | `measured` (the ACL-semantics row in `DocsPage.tsx` is tagged `measured`) | same stock sources as row 2 |
| 4 | Concurrent-client cap | Stock builds degrade above ~8 associated clients (RAM-budgeted, firmware-specific); ESP32-C3 builds cap lower (~5); the ESP-IDF SoftAP `max_connection` option is version-dependent and modeled separately. The validation checklist target is 8 clients (12 for `target-v1`) with ±25% tolerance. | Spec §3.1, §14; `src/engine/validation.ts:51-62`; `src/registry/profiles.ts:148`; `src/app/pages/DocsPage.tsx:51-56`; `src/app/pages/OverviewPage.tsx:6` | `estimate` | stock firmware README and ESP-IDF SoftAP configuration (named in spec §14; no URL recorded in-repo) |
| 5 | Routed throughput band | Stock firmware reports roughly 5–15 Mbps routed; the lab uses this as a checklist note/target until real numbers are recorded and imported. Checklist tolerance ±20%. | `src/engine/validation.ts:35-38`; `src/app/pages/DocsPage.tsx:57-61` | `estimate` | attributed in-code to "stock firmware reports" (no URL recorded in-repo) |
| 6 | Internal EMAC availability | ESP32-S2/S3/C3/C5/C6-class chips have no internal EMAC and cannot attach RMII PHYs; only ESP32/P4/S31-class chips carry an RMII-capable internal EMAC; SPI adapters (W5500/W5100/DM9051/ENC28J60) are the fallback. The UI flags the mismatch; the engine does not reject it. | Spec §3.1, §3.2; `src/registry/profiles.ts:114-186,199-208`; `src/app/pages/HardwarePage.tsx:156-167`; `src/app/pages/DocsPage.tsx:63-68`; `src/app/pages/OverviewPage.tsx:7` | `datasheet` | chip datasheets (named in spec §3.1; no URL recorded in-repo). Registry coverage: board profiles exist for S2, S3, C3, C6, P4, H2; no C5 or S31 profile is shipped. |
| 7 | ESP32 RMII pin map (devkit + generic LAN8720 module) | Fixed pins: REF_CLK GPIO0 (input mode), TX_EN GPIO21, TXD0 GPIO19, TXD1 GPIO22, RXD0 GPIO25, RXD1 GPIO26, CRS_DV GPIO27. Stock build defaults: MDC GPIO23, MDIO GPIO18. PHY address is 0 or 1 depending on the module; PHY power GPIO only if the module has one, never GPIO12 (strapping); modules without an oscillator need the ESP32 to output 50 MHz (e.g. GPIO17), PHY-clocked boards use input mode. | Spec §17; `src/app/pages/HardwarePage.tsx:190-194`; `src/app/pages/DocsPage.tsx:71-73` | `datasheet` | module schematics and ESP-IDF Ethernet configuration (named in spec §17; no URL recorded in-repo) |
| 8 | WT32-ETH01 prebuilt binary wiring | PHY address 1, RMII clock from the PHY, PHY power on GPIO16; this matches the stock firmware's prebuilt Ethernet binary. | Spec §3.1; `src/registry/profiles.ts:110-113`; `src/app/pages/HardwarePage.tsx:182-195` | `datasheet` | stock firmware prebuilt binary assumptions (named in spec §3.1; no URL recorded in-repo) |
| 9 | lwIP build options for routing/NAPT | `LWIP_IP_FORWARD`, `LWIP_IPV4_NAPT`, `LWIP_IPV4_NAPT_PORTMAP` and `LWIP_L2_TO_L3_COPY` are the flags that provide forwarding, NAPT, port mapping and the L2→L3 copy path — the reason routed frames are visible to the stack while relayed frames are not. | Spec §18; `src/app/pages/DocsPage.tsx:75-80` | `datasheet` | stock firmware lwIP build configuration (per spec §18; no URL recorded in-repo) |
| 10 | Stock enforcement technique | The stock firmware wraps `netif->input` / `netif->linkoutput` hooks (stock `netif_hooks.c`). L2-relayed client traffic never passes this point, which is why it is never filtered. | Spec §18 | `datasheet` | stock firmware source file `netif_hooks.c` (named in spec §18; no URL recorded in-repo) |
| 11 | `eth2ap` is L2-only; no official Ethernet-WAN NAT example | `examples/network/eth2ap` is a pure L2 bridge with no IP stack, and ESP-IDF `examples/network/` contains no official Ethernet-uplink NAT example. The official minimal baseline is `examples/wifi/softap_sta` + NAPT: pure forward/NAT with no filtering and no management surface. | Spec §3.3, §18; `src/registry/profiles.ts:48-60` | `datasheet` | ESP-IDF examples tree (per spec §3.3; no URL recorded in-repo) |
| 12 | NAPT capacity is configuration, not measurement | 2048 mappings per firmware profile is engine configuration (`naptCapacity`); exhaustion behavior is modeled at that configured size. The NAPT port range 49152–65535 is an engine constant. | `src/app/pages/DocsPage.tsx:81-86`; `src/registry/profiles.ts:32`; `src/engine/nat.ts:3-5`; `src/engine/model.ts:149-155` | `estimate` | none claimed |
| 13 | Device traffic-shape calibration | Archetype traffic cadence follows the IoTDI 2020 calibration (Mazhar & Shafiq); traffic profiles are tagged `paper`; demo endpoints (e.g. `203.0.113.65`) are tagged `assumption`. | Spec §10; `docs/DECISIONS.md` (M4); `src/registry/devices.ts:20-22,26-36`; `src/engine/traffic.ts:43-141` | `paper` | Mazhar & Shafiq, IoTDI 2020 (year recorded; no URL recorded in-repo) |
| 14 | Board specs | ESP32-WROOM-32D: 2× LX6 @240 MHz, 802.11 b/g/n, ~520 KB SRAM. WT32-ETH01: 2× LX6 @240 MHz, ~520 KB SRAM. Other boards per registry (`esp32-s2` 320 KB, `esp32-s3` 512 KB, `esp32-c3` 400 KB, `esp32-c6` 512 KB, `esp32-p4` 768 KB, `esp32-h2` 320 KB). Chip revision is read via esptool; the marking `XX5R69`/`XXSR69` must never be used to infer capability. | Spec §3.1; `src/registry/profiles.ts:89-186` | `datasheet` | Espressif datasheets (named in spec §3.1; no URL recorded in-repo) |

## Notes on provenance conflicts in the repository

- `src/app/pages/OverviewPage.tsx:6` tags the combined row "~8 clients,
  5–15 Mbps routed" as `measured`, while `DocsPage.tsx` (provenance legend and
  facts table) and `validation.ts` tag both values `estimate`. This document
  follows the `estimate` tag, which matches the validation checklist
  (`provenance: cal.maxClients === null ? "estimate" : "measured"`).
- `docs/DECISIONS.md` (M4) records "22 archetypes" for
  `src/registry/devices.ts`; the file currently contains 23 entries. Counted
  values in this document use the file, not the log entry.
- The project's research brief asked for verified facts to be recorded with
  URLs. No URL exists in the repository sources for the facts above; this file
  therefore reproduces only the references that are actually recorded
  (issue number, upstream artifact names, study citation/years) and adds no
  guessed URLs.

## Scope limit

Facts not listed above are not asserted as verified by the lab. Anything the
engine models beyond this table is tagged `estimate` or `assumption` at the
point of use, and anything the lab cannot model honestly is listed in
`docs/LIMITATIONS.md` and `src/engine/attacks.ts` with `modeled: false`.
