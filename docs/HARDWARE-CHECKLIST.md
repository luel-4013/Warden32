# Hardware checklist

Reproducible procedure for validating the simulation on real hardware
(ESP32-WROOM-32D devkit + LAN8720, and WT32-ETH01 as the zero-build reference
board). The measurement rows mirror what the lab's hardware checklist actually
asks for: `buildValidationChecklist` (`src/engine/validation.ts:22-74`) emits
exactly four checks — LAN→WAN throughput, WAN→LAN throughput, concurrent
clients, free heap at idle. The in-app table is `src/app/pages/HardwarePage.tsx`
(section 6); the exported plan is produced by `validationToMarkdown`.

**Honesty rule (non-negotiable):** never copy simulated values into the
`measured` columns. Only numbers typed from real hardware count as `measured`.
Expected values tagged `estimate` are model targets, not measurements.

**Safety:** run everything only on a controlled, owner-operated network. Do
not test against networks you do not own (spec §2, §17).

## 1. Parts

| Part | Detail | Note |
| --- | --- | --- |
| ESP32 devkit | Owner's ESP32-WROOM-32D devkit ("ESP32-30 CH340C" per spec §3.1); 2× LX6 @240 MHz, ~520 KB SRAM (`datasheet`) | Primary target (`src/registry/profiles.ts:90-100`) |
| Generic LAN8720 RMII breakout | Waveshare-class modules are commonly PHY address 1, others 0 (spec §17) | Verify the module schematic: PHY address, clock mode, optional power pin |
| WT32-ETH01 | Integrated LAN8720; matches the stock prebuilt Ethernet binary | Zero-build reference board (`src/registry/profiles.ts:102-113`) |
| USB data cable + serial terminal | For flashing and reading serial logs | Read chip revision with `esptool`; never infer capability from the `XX5R69`/`XXSR69` marking (spec §3.1) |
| Controlled upstream network | Owner's home router plus a WAN-side host usable as a test server | Double-NAT chain per the sample topology |
| Guest test clients | Devices to associate 1→10 on the SoftAP | Phones, laptops, or spare IoT hardware |
| Workstation tooling | `iperf3` client and server capability, `ping` | Method recorded with every number (spec §17) |

## 2. Wiring to verify (devkit + generic LAN8720)

Fixed RMII pins (spec §17; the stock build defaults for MDC/MDIO are also shown
in the app at `src/app/pages/HardwarePage.tsx:190-194`):

| Signal | ESP32 pin | Verification |
| --- | --- | --- |
| REF_CLK | GPIO0 (input mode) | Fixed pin; check the clock source mode first |
| TX_EN | GPIO21 | Fixed pin |
| TXD0 | GPIO19 | Fixed pin |
| TXD1 | GPIO22 | Fixed pin |
| RXD0 | GPIO25 | Fixed pin |
| RXD1 | GPIO26 | Fixed pin |
| CRS_DV | GPIO27 | Fixed pin |
| MDC | GPIO23 | Stock build default; matches `menuconfig` |
| MDIO | GPIO18 | Stock build default; matches `menuconfig` |
| PHY address | — | 0 or 1 depending on the module (WT32: 1). Verify against the module before flashing |
| RMII clock | — | Module without oscillator: ESP32 outputs 50 MHz (e.g. GPIO17). PHY-clocked module: input mode (WT32-style). Verify the schematic |
| PHY power | — | Only if the module has a power pin; **never GPIO12** (strapping) |

WT32-ETH01 prebuilt-binary assumption, shown in the app as `datasheet`:
PHY address 1, RMII clock from the PHY, PHY power GPIO16
(`src/registry/profiles.ts:112`; `src/app/pages/HardwarePage.tsx:182-195`).
Verify against the actual module schematic before flashing.

## 3. Firmware builds to flash

| Target | Build | Source |
| --- | --- | --- |
| WT32-ETH01 | Stock prebuilt Ethernet binary via the browser web installer — no compiling | Spec §17 |
| Devkit + generic LAN8720 | One custom build of the stock firmware: `idf.py menuconfig` → `Uplink: Ethernet (LAN8720)`; set PHY address and clock mode per the module | Spec §17 |
| Minimal baseline | ESP-IDF `examples/wifi/softap_sta` + NAPT (official; pure forward/NAT, no filtering, no management surface) | `src/registry/profiles.ts:48-60`; spec §3.3 |
| `target-v1` | Does not exist on hardware — not flashable. Hardware comparison is future work | `src/registry/profiles.ts:61-73` (`implementedOnHardware: false`) |

## 4. Measurement procedures mapped to the checklist

Connection rules (`evaluateValidation`): nothing entered → `no-data`;
`|delta| <= tolerance` → `ok`; `<= 2× tolerance` → `warn`; beyond → `fail`
(`src/engine/validation.ts:76-86`). Tolerances below are the exact values
defined in `buildValidationChecklist`.

| Checklist id | Label | Unit | Target before calibration | Tolerance | Procedure | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `throughput-lan-wan` | LAN→WAN throughput | Mbps | `null` until a calibration profile is imported; in-code note: "stock firmware reports 5–15 Mbps routed" (`estimate`) | ±20% | `iperf3` TCP (UDP optional, quote loss because TCP is the comparable figure) from a guest Wi-Fi client to a WAN-side server; 3 runs; record the median; state tool version, duration, direction, band/channel, distance, other clients | Inbound is the reverse direction (next row); per spec §17 measure both |
| `throughput-wan-lan` | WAN→LAN throughput | Mbps | `null`; in-code note: "inbound is usually slightly slower on this class of device" (`estimate`) | ±20% | Same test, reversed: server on the WAN side to a guest client | Record if UDP shows a different band |
| `clients` | Concurrent clients | clients | 8 (`estimate`); 12 for `target-v1` | ±25% | Attach clients 1→10; record the highest count at which all attached clients still pass routed traffic; note association/DHCP failures as the count rises | ESP32-C3 builds cap lower (~5, `estimate`) |
| `ram` | Free heap at idle | KB | `board.ramKb − 180 KB` target: 340 KB for the 520 KB boards (`datasheet` SRAM minus `estimate` base) | ±30% | Read free heap from the serial log after boot, before any guest load | Optional supporting series per spec §17: free heap versus client count 1→10 |

Supplementary protocol checks from spec §17 that are **not** rows in this
build's checklist (record them as notes; do not substitute them for the four
rows above): ICMP latency/loss idle and under load; ACL hit counters with one
verified dropped and one verified allowed flow; the two-client
lateral-movement proof (host-to-host traffic succeeds and is invisible to the
ESP32 — the direct test of the no-isolation model, issue #13781); ARP
visibility; reboot/cold-boot policy; NAPT behavior under table pressure.
Latency, jitter, CPU and throughput series beyond these four checks are not
part of `buildValidationChecklist` in this build.

## 5. Record results template

Fill one row per checklist item per board/firmware combination. The `expected`
value comes from the checklist (calibration profile or model target); enter
`measured` only from the real test.

| check id | expected (source) | unit | tolerance | measured | delta % | status | method and conditions | date | board | firmware |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `throughput-lan-wan` | 9.8 (`measured`, imported example) or "not calibrated" until imported | Mbps | ±20% | | | | iperf3 TCP; record duration, band, distance, load state; 3 runs median | | | |
| `throughput-wan-lan` | as imported or `null` | Mbps | ±20% | | | | same, reversed | | | |
| `clients` | 8 (`estimate`) | clients | ±25% | | | | associate 1→10, count stable routed traffic | | | |
| `ram` | 340 (`datasheet` − `estimate`) | KB | ±30% | | | | serial free-heap after boot, idle | | | |

Delta and status are computed by `evaluateValidation` when the numbers are
entered in the app; the exported Markdown table
(`warden32-validation-plan.md`) carries the same columns and ends with the
statement that the lab never invents `measured` values
(`src/engine/validation.ts:96-107`).

## 6. Importing results as calibration

Recorded numbers enter the lab through a `warden32.calibration` JSON file,
imported on the Hardware page (`src/engine/calibration.ts:96-152`;
`src/app/pages/HardwarePage.tsx:348-434`). Example shape (all metrics nullable;
only fill what you actually measured; the values below mirror the test fixture
in `src/engine/calibration.test.ts:13-33`):

```json
{
  "kind": "warden32.calibration",
  "version": 1,
  "profile": {
    "id": "bench-wt32-1",
    "name": "Owner bench run 1",
    "source": "esp32_nat_router on WT32-ETH01, iperf3",
    "createdAtMs": 0,
    "notes": "conditions: band, channel, distance, load state",
    "provenance": "measured",
    "metrics": {
      "cpuCostEthernet": null,
      "cpuCostWifiUplink": null,
      "airtimeRoutedEthernet": null,
      "airtimeRoutedWifi": null,
      "airtimeL2Relay": null,
      "ramBaseKb": null,
      "throughputMbpsLanToWan": 9.8,
      "throughputMbpsWanToLan": 8.1,
      "maxClients": 6
    }
  }
}
```

Current wiring (documented honestly): a valid import supplies the
"expected" values in the validation table, but it is not written into the
project and the engine keeps its default constants
(`src/app/pages/HardwarePage.tsx:429-433`). The engine module itself accepts a
calibration profile and applies it (`src/engine/calibration.test.ts:60-88`).

## 7. Honesty rules

- Never copy simulated values into `measured` columns; expected values tagged
  `estimate` are model targets, not measurements.
- Record method, unit and conditions with every number (spec §17).
- Never present simulated throughput as a hardware benchmark.
- If a measurement lands outside the tolerance bands, record it anyway — that
  is exactly what the falsification list in `docs/LIMITATIONS.md` asks for.
