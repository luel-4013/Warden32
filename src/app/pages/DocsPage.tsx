import { useApp } from "../store";
import { Chip, Pane, type Tone } from "../ui";
import { ENGINE_VERSION } from "../../storage/project";

const PROVENANCE_LEGEND: { tag: string; tone: Tone; meaning: string; example: string }[] = [
  {
    tag: "measured",
    tone: "ok",
    meaning: "Observed on real hardware or verified against a primary upstream source (source code, issue tracker, official docs); re-measurable with the exported checklist.",
    example: "client-to-client Wi-Fi frames never reach lwIP (esp-idf #13781); stock ACLs ignore non-IPv4"
  },
  {
    tag: "datasheet",
    tone: "accent",
    meaning: "Vendor documentation: chip/board datasheets, module schematics, official build configuration.",
    example: "board SRAM sizes; internal EMAC presence; WT32-ETH01 wiring (PHY 1, clock from PHY, power GPIO 16)"
  },
  {
    tag: "paper",
    tone: "muted",
    meaning: "Published research or industry calibration that shapes a model; not measured in this lab.",
    example: "device traffic cadence in the archetype library"
  },
  {
    tag: "estimate",
    tone: "warn",
    meaning: "Model constant chosen to approximate real behavior; unverified until calibration data is imported.",
    example: "CPU/airtime cost units, RAM budget costs, ~8-client cap, 5–15 Mbps routed band"
  },
  {
    tag: "assumption",
    tone: "warn",
    meaning: "Scenario scaffolding with no hardware claim: addresses, fictional endpoints, hypothetical designs.",
    example: "demo cloud 203.0.113.65; target design v1 (not implemented on hardware)"
  }
];

const VERIFIED_FACTS: { fact: string; detail: string; provenance: string }[] = [
  {
    fact: "no Wi-Fi client isolation",
    detail:
      "On ESP32 SoftAP, client-to-client frames are relayed inside the closed-source Wi-Fi driver and never reach lwIP. There is no isolation API; espressif/esp-idf issue #13781 was closed not_planned. The lab shows such traffic as not-enforceable — never 'blocked' — and it consumes airtime only, no CPU/NAT/ACL cost.",
    provenance: "measured"
  },
  {
    fact: "stock ACL semantics",
    detail:
      "The stock firmware's firewall is a stateless first-match 4-list ACL (uplink↔AP) with default ALLOW; non-IPv4 (ARP, IPv6) passes unfiltered. There is no DNS blocklist — only a custom-DNS setting for DHCP clients.",
    provenance: "measured"
  },
  {
    fact: "concurrent client cap",
    detail:
      "Stock builds degrade above ~8 associated clients (RAM-budgeted, firmware-specific); the ESP-IDF SoftAP max_connection option is version-dependent and modeled separately. ESP32-C3 builds cap lower (~5).",
    provenance: "estimate"
  },
  {
    fact: "routed throughput band",
    detail:
      "Stock firmware reports roughly 5–15 Mbps routed. The validation checklist uses this as an estimate target until real numbers are recorded on owner hardware.",
    provenance: "estimate"
  },
  {
    fact: "no internal EMAC on S2/S3/C3/C5/C6",
    detail:
      "Only ESP32, P4 and S31-class chips carry an RMII-capable internal EMAC; SPI adapters (W5500/W5100/DM9051/ENC28J60) are the fallback elsewhere. The hardware page flags the mismatch.",
    provenance: "datasheet"
  },
  {
    fact: "WT32-ETH01 stock binary wiring",
    detail:
      "The prebuilt stock Ethernet binary assumes PHY address 1, RMII clock from the PHY and PHY power on GPIO 16. A generic LAN8720 breakout needs a custom build (MDC GPIO23 / MDIO GPIO18 defaults; verify PHY address and clock mode against the module).",
    provenance: "datasheet"
  },
  {
    fact: "lwIP build options in the target build",
    detail:
      "LWIP_IP_FORWARD, LWIP_IPV4_NAPT, LWIP_IPV4_NAPT_PORTMAP and LWIP_L2_TO_L3_COPY are the flags that give forwarding, NAPT and the L2→L3 copy path — the reason routed frames are visible to the stack while relayed frames are not.",
    provenance: "datasheet"
  },
  {
    fact: "NAPT capacity",
    detail:
      "2048 mappings per firmware profile is engine configuration (naptCapacity), not a measured device limit; exhaustion behavior is modeled at that configured size.",
    provenance: "estimate"
  }
];

export default function DocsPage() {
  const { setPage } = useApp();
  return (
    <div className="page">
      <h2>docs · limitations</h2>
      <div className="row">
        <button onClick={() => setPage("hardware")}>hardware & calibration</button>
        <button onClick={() => setPage("registry")}>registry</button>
        <button onClick={() => setPage("rules")}>firewall rules</button>
        <button onClick={() => setPage("attacks")}>attack lab</button>
        <button onClick={() => setPage("resources")}>resources</button>
        <button onClick={() => setPage("experiments")}>experiments</button>
      </div>

      <Pane title="1 · what this lab is / is not">
        <div className="grid2">
          <div className="card">
            <h4>
              is <Chip tone="ok">simulation</Chip>
            </h4>
            <div className="meta">
              A deterministic simulation of the ESP32 firewall/NAT pipeline: classify, policy dialects, conntrack, double NAT, routing,
              resource limits and verdicts. Same project plus same seed produce an identical event stream. It runs entirely in the browser —
              no accounts, no backend, no network I/O, no real attack traffic. Every numeric value carries a provenance tag.
            </div>
          </div>
          <div className="card">
            <h4>
              is not <Chip tone="warn">limits</Chip>
            </h4>
            <div className="meta">
              Not a packet-level bench and not a radio simulator: there are no real 802.11 frames, no timing or thermal effects, no TCP
              congestion fidelity and no firmware flashing. Simulated throughput is a model output and must never be presented as a hardware
              benchmark.
            </div>
          </div>
        </div>
      </Pane>

      <Pane title="2 · pipeline order">
        <div className="reason">
          classify / visibility → offline check → quarantine → L2-visibility exit → spoof check → esp32-local / inbound / outbound branch →
          policy (dialect rules; device egress allowlist only under stateful) → NAPT double NAT → route lookup → upstream reachability →
          verdict
        </div>
        <div className="grid3">
          <div className="card">
            <h4>esp32-local</h4>
            <div className="meta">
              Traffic addressed to the router itself. Stock firmware has no local-input ACL, so the management surface is reachable (warn);
              the target design defaults to deny with serial-only management — flagged not implemented on hardware.
            </div>
          </div>
          <div className="card">
            <h4>inbound</h4>
            <div className="meta">
              Conntrack return match first, then port validity, then a forward must exist on both NAT layers (upstream router and ESP32) —
              a missing forward on either drops with a boundary-specific reason. The ACL runs after the forwards; an allowed flow builds the
              double-NAT DNAT chain.
            </div>
          </div>
          <div className="card">
            <h4>outbound</h4>
            <div className="meta">
              Under stateful filtering, INVALID states drop before rules; established flows bypass rule evaluation; the device egress
              allowlist applies only under stateful. Then NAPT translation, route lookup, upstream reachability and tx/buffer admission.
            </div>
          </div>
        </div>
        <p className="meta">
          Frames invisible to the enforcement point (client-to-client relay, 802.11 management) exit before policy with verdict
          not-enforceable and an airtime-only cost. Every result carries scope, visibility, enforcement point, NAT chain, labels and
          structured events; the same labels drive the packets.log chips.
        </p>
      </Pane>

      <Pane title="3 · verified facts" right={<Chip tone="muted">sources: DECISIONS.md · reality model §3</Chip>}>
        <table className="table">
          <thead>
            <tr>
              <th>fact</th>
              <th>detail</th>
              <th>provenance</th>
            </tr>
          </thead>
          <tbody>
            {VERIFIED_FACTS.map((entry) => (
              <tr key={entry.fact}>
                <td>{entry.fact}</td>
                <td>{entry.detail}</td>
                <td>
                  <Chip tone={entry.provenance === "datasheet" ? "accent" : entry.provenance === "measured" ? "ok" : "warn"}>
                    {entry.provenance}
                  </Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Pane>

      <Pane title="4 · provenance legend">
        <table className="table">
          <thead>
            <tr>
              <th>tag</th>
              <th>meaning</th>
              <th>example in this build</th>
            </tr>
          </thead>
          <tbody>
            {PROVENANCE_LEGEND.map((entry) => (
              <tr key={entry.tag}>
                <td>
                  <Chip tone={entry.tone}>{entry.tag}</Chip>
                </td>
                <td>{entry.meaning}</td>
                <td className="meta">{entry.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="meta">
          Values are never silently mixed: an imported calibration stays tagged with its own provenance, model constants stay estimate, and
          datasheet/measured facts keep their sources. The hardware page shows where each tag is used.
        </p>
      </Pane>

      <Pane title="5 · limitations & falsification" right={<Chip tone="warn">honest by construction</Chip>}>
        <div className="grid2">
          <div className="card">
            <h4>not modeled</h4>
            <div className="meta">
              Real radio behavior (rates, retries, collisions, airtime fairness), thermal/EMI effects and silicon errata, TCP congestion and
              retransmission dynamics, closed-source driver internals, browser and OS networking, and any form of firmware control.
            </div>
          </div>
          <div className="card">
            <h4>analytic approximations</h4>
            <div className="meta">
              Queueing, RAM and CPU are estimate-grade analytic models. CPU above 100% adds a latency label instead of dropping, by design —
              real firmware slows down rather than losing packets there. The upstream NAT is simplified to a deterministic table.
            </div>
          </div>
          <div className="card">
            <h4>what would falsify the model</h4>
            <div className="meta">
              Recorded hardware numbers outside the checklist tolerance bands (throughput, clients, free heap); a two-client lateral test
              showing host-to-host frames reaching lwIP (contradicting the no-isolation model); stock ACL behavior that is not stateless
              4-list default-allow; or RMII working on an S2/S3/C3-class chip. Run the exported validation plan to attempt each.
            </div>
          </div>
          <div className="card">
            <h4>safety scope</h4>
            <div className="meta">
              Attack scenarios, scans and hostile device behavior exist only inside the simulation. The app never generates real traffic and
              never contacts the fictional endpoints. The lab is for study of your own, controlled networks.
            </div>
          </div>
        </div>
      </Pane>

      <Pane
        title="6 · reproduction & provenance of the run"
        right={
          <Chip tone="accent">engine {ENGINE_VERSION}</Chip>
        }
      >
        <div className="grid3">
          <div className="card">
            <h4>determinism</h4>
            <div className="meta">
              Simulation uses a virtual clock and a seeded PRNG (mulberry32); no wall-clock reads and no Math.random decide outcomes. Same
              configuration plus same seed ⇒ identical event stream and verdicts.
            </div>
          </div>
          <div className="card">
            <h4>.warden32 project files</h4>
            <div className="meta">
              One human-readable JSON file per lab: schema warden32.project v1, engine version stamped, FNV-1a checksum verified on load.
              Autosave keeps the latest state in browser storage; the same file can be dragged back in without a server.
            </div>
          </div>
          <div className="card">
            <h4>exports carry their terms</h4>
            <div className="meta">
              Calibration JSON, the validation-plan Markdown and project files all state what is measured, estimated or assumed.
              Reproducing a result means the same project file and seed with the engine version recorded above.
            </div>
          </div>
        </div>
        <p className="meta">
          The status bar always shows the live firmware name, policy baseline, ACL dialect, seed, node count and engine version so a
          screenshot of a result remains reproducible.
        </p>
      </Pane>
    </div>
  );
}
