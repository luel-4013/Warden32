import { useRef, useState, type ChangeEvent } from "react";
import { useApp } from "../store";
import { Chip, Empty, KV, Pane, toneForLabel, type Tone } from "../ui";
import { ETHERNET_ADAPTERS, FIRMWARE_PROFILES, HARDWARE_PROFILES } from "../../registry/profiles";
import {
  DEFAULT_CALIBRATION,
  parseCalibration,
  serializeCalibration,
  type CalibrationProfile
} from "../../engine/calibration";
import {
  AIRTIME_L2_RELAY,
  AIRTIME_ROUTED_ETHERNET,
  AIRTIME_ROUTED_WIFI,
  CPU_ETHERNET,
  CPU_WIFI_UPLINK,
  RAM_BASE_KB
} from "../../engine/calibrationDefaults";
import {
  buildValidationChecklist,
  evaluateValidation,
  recordMeasurement,
  validationToMarkdown
} from "../../engine/validation";
import { readTextFile } from "../../storage/persistence";
import type { Provenance } from "../../engine/types";

interface CalibrationImport {
  fileName: string;
  ok: boolean;
  profile: CalibrationProfile | null;
  errors: string[];
}

function provenanceTone(provenance: Provenance): Tone {
  if (provenance === "measured") return "ok";
  if (provenance === "datasheet") return "accent";
  if (provenance === "assumption") return "warn";
  return "muted";
}

const STATUS_TONE: Record<"ok" | "warn" | "fail" | "no-data", Tone> = {
  ok: "ok",
  warn: "warn",
  fail: "danger",
  "no-data": "muted"
};

const CALIBRATION_CONSTANTS: { name: string; value: number; unit: string; drives: string }[] = [
  { name: "CPU_ETHERNET", value: CPU_ETHERNET, unit: "CPU units/packet", drives: "routed cost, Ethernet uplink" },
  { name: "CPU_WIFI_UPLINK", value: CPU_WIFI_UPLINK, unit: "CPU units/packet", drives: "routed cost, Wi-Fi STA uplink" },
  { name: "AIRTIME_ROUTED_ETHERNET", value: AIRTIME_ROUTED_ETHERNET, unit: "airtime units/packet", drives: "routed Ethernet frames" },
  { name: "AIRTIME_ROUTED_WIFI", value: AIRTIME_ROUTED_WIFI, unit: "airtime units/packet", drives: "routed Wi-Fi frames" },
  { name: "AIRTIME_L2_RELAY", value: AIRTIME_L2_RELAY, unit: "airtime units/frame", drives: "client-to-client L2 relay (no CPU/NAT cost)" },
  { name: "RAM_BASE_KB", value: RAM_BASE_KB, unit: "KB", drives: "base heap consumed by the RAM model" }
];

export default function HardwarePage() {
  const app = useApp();
  const { project, engine } = app;
  const [measureInputs, setMeasureInputs] = useState<Record<string, string>>({});
  const [imported, setImported] = useState<CalibrationImport | null>(null);
  const calibrationFile = useRef<HTMLInputElement>(null);

  const board = HARDWARE_PROFILES.find((profile) => profile.id === project.sim.boardId) ?? null;
  const adapter = ETHERNET_ADAPTERS.find((profile) => profile.id === project.sim.adapterId) ?? null;
  const activeCalibration = imported?.ok && imported.profile ? imported.profile : DEFAULT_CALIBRATION;
  const checklist = buildValidationChecklist(project, activeCalibration);
  const withMeasurements = checklist.reduce((acc, item) => {
    const raw = measureInputs[item.id];
    const parsed = raw === undefined || raw.trim() === "" ? null : Number(raw);
    return recordMeasurement(acc, item.id, parsed !== null && Number.isFinite(parsed) ? parsed : null);
  }, checklist);
  const rows = evaluateValidation(withMeasurements);
  const snapshot = engine.resourceSnapshot();
  const ramPct = snapshot.ramLimitKb > 0 ? Math.min(100, Math.round((snapshot.ramUsedKb / snapshot.ramLimitKb) * 100)) : 0;
  const gaugeTone = ramPct >= 85 ? "danger" : ramPct >= 60 ? "warn" : "";

  const onImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    const parsed = parseCalibration(await readTextFile(file));
    setImported({ fileName: file.name, ok: parsed.ok, profile: parsed.profile, errors: parsed.errors });
    app.setNotice(
      parsed.ok
        ? `calibration "${parsed.profile?.name ?? file.name}" parsed — validated and displayed only; the engine keeps its defaults`
        : `calibration import failed: ${parsed.errors.join("; ")}`
    );
  };

  return (
    <div className="page">
      <h2>hardware · calibration</h2>
      <Pane title="1 · boards" right={<Chip tone="accent">{board?.name ?? `unknown: ${project.sim.boardId}`}</Chip>}>
        <p className="meta">
          Board SRAM and radios are datasheet values. Chips without an internal EMAC cannot attach RMII PHYs (LAN8720, KSZ8081, YT8531) —
          SPI adapters only. Selecting a board writes sim.boardId and rebuilds the engine; this page flags impossible combinations, the
          engine itself does not reject them.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>board</th>
              <th>chip</th>
              <th>wi-fi</th>
              <th>ethernet</th>
              <th>SRAM</th>
              <th>provenance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {HARDWARE_PROFILES.map((profile) => (
              <tr key={profile.id}>
                <td>
                  <strong>{profile.name}</strong>
                  {profile.id === project.sim.boardId ? <Chip tone="ok">selected</Chip> : null}
                  <div className="meta">{profile.note}</div>
                </td>
                <td>
                  {profile.cores} @ {profile.clockMhz} MHz
                </td>
                <td>{profile.wifi ?? <Chip tone="warn" title="no Wi-Fi radio on this chip">no Wi-Fi</Chip>}</td>
                <td>
                  {profile.ethernetBus}{" "}
                  {profile.internalEmac ? (
                    <Chip tone="ok" title="datasheet">
                      internal EMAC
                    </Chip>
                  ) : (
                    <Chip tone="warn" title="datasheet">
                      no EMAC
                    </Chip>
                  )}
                </td>
                <td>{profile.ramKb} KB</td>
                <td>
                  <Chip tone={provenanceTone(profile.provenance)}>{profile.provenance}</Chip>
                </td>
                <td>
                  <button
                    onClick={() =>
                      app.setProject((draft) => {
                        draft.sim.boardId = profile.id;
                      })
                    }
                  >
                    use
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {board && !board.internalEmac ? (
          <div className="card">
            <h4>
              <Chip tone="warn">compatibility</Chip> {board.name} has no internal EMAC
            </h4>
            <div className="meta">
              Datasheet fact: ESP32-S2 / S3 / C3 / C5 / C6-class chips carry no internal EMAC, so RMII-capable PHYs cannot attach. Use an
              SPI adapter (W5500 / W5100 / DM9051 / ENC28J60) or select an ESP32 / P4-class board — only ESP32 / P4 / S31-class chips have an
              RMII-capable internal EMAC.
            </div>
          </div>
        ) : null}
        {board && !board.wifi ? (
          <div className="card">
            <h4>
              <Chip tone="warn">compatibility</Chip> {board.name} has no Wi-Fi radio
            </h4>
            <div className="meta">
              SoftAP topologies and Wi-Fi STA uplink firmware profiles are unsupported on this chip unless a companion radio is modeled; the
              registry note marks it as unsupported, the engine still builds the selection.
            </div>
          </div>
        ) : null}
      </Pane>

      <Pane title="2 · ethernet adapters" right={<Chip tone="accent">{adapter?.name ?? `unknown: ${project.sim.adapterId}`}</Chip>}>
        <div className="card">
          <h4>WT32-ETH01 prebuilt stock binary — assumed module wiring</h4>
          <div className="row">
            <Chip tone="accent">PHY address 1</Chip>
            <Chip tone="accent">RMII clock from PHY</Chip>
            <Chip tone="accent">PHY power GPIO 16</Chip>
            <Chip tone={provenanceTone("datasheet")}>datasheet</Chip>
          </div>
          <div className="meta">
            The prebuilt Ethernet binary expects this wiring; verify against the actual module schematic before flashing. On a generic LAN8720
            breakout the PHY address may be 0 or 1, the clock mode and power pin depend on the module, and GPIO12 must never be used
            (strapping).
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>adapter</th>
              <th>bus</th>
              <th>nominal</th>
              <th>cpu cost</th>
              <th>EMAC</th>
              <th>provenance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ETHERNET_ADAPTERS.map((profile) => (
              <tr key={profile.id}>
                <td>
                  <strong>{profile.name}</strong>
                  {profile.id === project.sim.adapterId ? <Chip tone="ok">selected</Chip> : null}
                  <div className="meta">{profile.note}</div>
                </td>
                <td>{profile.bus}</td>
                <td>{profile.nominalMbps} Mbps</td>
                <td>{profile.cpuCostPerPacket} units/packet</td>
                <td>
                  {profile.requiresInternalEmac ? (
                    board && !board.internalEmac ? (
                      <Chip tone="warn">requires internal EMAC — {board.name} has none</Chip>
                    ) : (
                      <Chip tone="muted">internal EMAC required</Chip>
                    )
                  ) : (
                    <Chip tone="muted">no EMAC needed</Chip>
                  )}
                </td>
                <td>
                  <Chip tone={provenanceTone(profile.provenance)}>{profile.provenance}</Chip>
                </td>
                <td>
                  <button
                    onClick={() =>
                      app.setProject((draft) => {
                        draft.sim.adapterId = profile.id;
                      })
                    }
                  >
                    use
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="meta">
          Honest wiring: the adapter id is stored in sim.adapterId and shown as the status-bar link. The per-adapter throughput and CPU-cost
          columns are registry data (estimate where tagged); in this build the routed cost used by runs comes from the firmware uplink
          calibration, not from the adapter entry.
        </p>
      </Pane>

      <Pane title="3 · firmware profiles" right={<Chip tone="accent">current: {app.meta().firmwareName}</Chip>}>
        <p className="meta">
          Applying a profile rewrites firewall.dialect, firewall.defaultPolicy and sim.policyBaseline (target-v1 → stateful / deny / P-C;
          softap-sta → none / allow / P-A; stock builds → stock-4list / allow / P-B) and clears pending flow results.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>profile</th>
              <th>acl / policy</th>
              <th>features</th>
              <th>management surface</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {Object.values(FIRMWARE_PROFILES).map((profile) => (
              <tr key={profile.id}>
                <td>
                  <strong>{profile.name}</strong>
                  {profile.id === project.sim.firmwareId ? <Chip tone="ok">active</Chip> : null}
                  {profile.implementedOnHardware ? (
                    <Chip tone="muted">on hardware</Chip>
                  ) : (
                    <Chip tone={toneForLabel("not implemented on hardware")}>not implemented on hardware</Chip>
                  )}
                  <div className="meta">{profile.note}</div>
                </td>
                <td>
                  <div>acl {profile.acl}</div>
                  <div>default {profile.defaultPolicy}</div>
                  <div>uplink {profile.uplink}</div>
                </td>
                <td>
                  <div>dns sinkhole {profile.dnsSinkhole ? "yes (hypothetical)" : "none"}</div>
                  <div>client isolation {profile.clientIsolation ? "yes" : "none possible on stock ESP32 Wi-Fi"}</div>
                  <div>NAPT {profile.naptCapacity} mappings</div>
                </td>
                <td>{profile.managementChannels.length > 0 ? profile.managementChannels.join(", ") : "none"}</td>
                <td>
                  <button onClick={() => app.applyFirmware(profile.id)}>apply</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Pane>

      <Pane
        title="4 · RAM budget"
        right={
          <Chip tone={snapshot.ramExhausted ? "danger" : "ok"}>
            {snapshot.ramUsedKb} / {snapshot.ramLimitKb} KB used
          </Chip>
        }
      >
        <KV
          k="board SRAM"
          v={
            <>
              {board ? `${board.ramKb} KB` : "unknown"} <Chip tone={provenanceTone("datasheet")}>datasheet</Chip>
            </>
          }
        />
        <KV
          k="model limit"
          v={
            <>
              {snapshot.ramLimitKb} KB{project.resources.ramOverrideKb !== null ? " (resources.ramOverrideKb overrides the board value)" : ""}
            </>
          }
        />
        <KV
          k="model used"
          v={
            <>
              {snapshot.ramUsedKb} KB <Chip tone={provenanceTone("estimate")}>estimate</Chip>
            </>
          }
        />
        <KV k="conntrack" v={`${snapshot.conntrackUsed} / ${snapshot.conntrackCapacity}`} />
        <KV k="NAPT" v={`${snapshot.naptUsed} / ${snapshot.naptCapacity}`} />
        <KV k="tx queue" v={`${snapshot.txQueueDepth} / ${snapshot.txQueueCapacity}`} />
        <div className="gauge">
          <div className={`gauge-fill ${gaugeTone}`} style={{ width: `${ramPct}%` }} />
        </div>
        <p className="meta">
          {ramPct}% of the model limit. The simulated RAM model is an estimate: {RAM_BASE_KB} KB base + 0.2 KB/connection + 0.15 KB/NAPT
          mapping + 1.6 KB/tx buffer, checked against board SRAM (datasheet). Above the limit the engine refuses new connection state and drops
          the flow with a RAM label — it does not crash or fake capacity.
        </p>
      </Pane>

      <Pane
        title="5 · calibration constants & import"
        right={
          <span className="row">
            <button
              onClick={() => app.exportText("warden32-calibration-default.json", serializeCalibration(DEFAULT_CALIBRATION))}
            >
              export calibration
            </button>
            <button onClick={() => calibrationFile.current?.click()}>import calibration</button>
          </span>
        }
      >
        <input
          ref={calibrationFile}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={onImport}
        />
        <table className="table">
          <thead>
            <tr>
              <th>constant</th>
              <th>value</th>
              <th>units</th>
              <th>drives</th>
              <th>provenance</th>
            </tr>
          </thead>
          <tbody>
            {CALIBRATION_CONSTANTS.map((constant) => (
              <tr key={constant.name}>
                <td>{constant.name}</td>
                <td>{constant.value}</td>
                <td>{constant.unit}</td>
                <td>{constant.drives}</td>
                <td>
                  <Chip tone={provenanceTone("estimate")}>estimate</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="meta">
          These are the engine's live defaults from calibrationDefaults.ts (resolveCalibration falls back to them per metric). The
          DEFAULT_CALIBRATION profile tags them estimate — treat them as assumptions until real measurements are imported. Export produces a
          warden32.calibration JSON file with these defaults.
        </p>
        {imported === null ? (
          <Empty text="no calibration profile imported — the engine runs on the defaults above" />
        ) : imported.ok && imported.profile ? (
          <div className="card">
            <h4>
              {imported.profile.name} <Chip tone="ok">parsed ok</Chip>{" "}
              <Chip tone={provenanceTone(imported.profile.provenance)}>{imported.profile.provenance}</Chip>
            </h4>
            <KV k="file" v={imported.fileName} />
            <KV k="id" v={imported.profile.id} />
            <KV k="source" v={imported.profile.source || "not provided"} />
            <KV k="notes" v={imported.profile.notes || "not provided"} />
            {Object.entries(imported.profile.metrics).filter(([, value]) => value !== null).length === 0 ? (
              <Empty text="all metrics are null — the profile carries no measured values" />
            ) : (
              Object.entries(imported.profile.metrics)
                .filter(([, value]) => value !== null)
                .map(([key, value]) => <KV key={key} k={key} v={String(value)} tone="ok" />)
            )}
          </div>
        ) : (
          <div className="card">
            <h4>
              import failed — {imported.fileName} <Chip tone="danger">invalid</Chip>
            </h4>
            {imported.errors.map((error) => (
              <div key={error} className="reason">
                {error}
              </div>
            ))}
          </div>
        )}
        <p className="meta">
          Honest wiring: an imported profile is parsed, validated and displayed here. It is not written into the project, and the engine still
          constructs with DEFAULT_CALIBRATION, so cost constants are not silently replaced. A valid imported profile does supply the
          "expected" values in the validation table below (buildValidationChecklist consumes it); engine runs do not.
        </p>
      </Pane>

      <Pane
        title="6 · hardware validation checklist"
        right={
          <button onClick={() => app.exportText("warden32-validation-plan.md", validationToMarkdown(rows))}>
            export validation plan
          </button>
        }
      >
        <p className="meta">
          recordMeasurement stores only numbers you type; evaluateValidation reports ok within ±tolerance, warn up to 2× tolerance, fail
          beyond that, and no-data when nothing is entered. Blank rows stay no-data — the lab never invents measured values. Expected values
          tagged estimate are model targets, not measurements.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>check</th>
              <th>target</th>
              <th>tolerance</th>
              <th>how to measure</th>
              <th>measured</th>
              <th>delta</th>
              <th>status</th>
              <th>provenance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.label}</td>
                <td>{row.expected === null ? "not calibrated" : `${row.expected} ${row.unit}`}</td>
                <td>±{row.tolerancePct}%</td>
                <td className="meta">{row.note}</td>
                <td>
                  <input
                    className="input"
                    type="number"
                    inputMode="decimal"
                    placeholder="not recorded"
                    style={{ width: 110 }}
                    value={measureInputs[row.id] ?? ""}
                    onChange={(event) =>
                      setMeasureInputs((current) => ({ ...current, [row.id]: event.target.value }))
                    }
                  />
                </td>
                <td>{row.deltaPct === null ? "—" : `${row.deltaPct > 0 ? "+" : ""}${row.deltaPct}%`}</td>
                <td>
                  <Chip tone={STATUS_TONE[row.status]}>{row.status}</Chip>
                </td>
                <td>
                  <Chip tone={provenanceTone(row.provenance)}>{row.provenance}</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="meta">
          Expected throughput/client values appear only when an imported calibration supplies them; otherwise they are null targets. The RAM
          row expectation tracks the selected board and the calibration's base value.
        </p>
      </Pane>
    </div>
  );
}
