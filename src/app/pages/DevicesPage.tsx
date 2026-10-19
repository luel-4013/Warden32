import { useMemo, useState } from "react";
import type { DeviceModel, ProjectModel, ZoneId } from "../../engine/model";
import { ETHERNET_ADAPTERS } from "../../registry/profiles";
import { iotArchetypes } from "../../registry/devices";
import { effectiveDemandMbps } from "../../engine/activity";
import {
  addDeviceToProject,
  defaultDemandFor,
  isRemovableDevice,
  removeDeviceFromProject
} from "../../storage/deviceOps";
import { useApp } from "../store";
import { Chip, Pane } from "../ui";

const ZONE_OPTIONS: ZoneId[] = ["guest", "trusted", "mgmt"];

function cloneProject(project: ProjectModel): ProjectModel {
  return JSON.parse(JSON.stringify(project)) as ProjectModel;
}

function parseOptionalNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
}

export default function DevicesPage() {
  const app = useApp();
  const [, setTick] = useState(0);
  const bump = () => setTick((value) => value + 1);
  const [archetypeId, setArchetypeId] = useState(iotArchetypes()[0]?.id ?? "camera");
  const [zone, setZone] = useState<ZoneId>("guest");
  const [name, setName] = useState("");
  const [demandText, setDemandText] = useState(() => String(defaultDemandFor(iotArchetypes()[0]?.id ?? "camera") ?? ""));
  const [capText, setCapText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const archetypes = useMemo(() => iotArchetypes(), []);
  const liveDevices = app.engine.project.devices;
  const adapter = ETHERNET_ADAPTERS.find((item) => item.id === app.project.sim.adapterId) ?? ETHERNET_ADAPTERS[0];
  const managed = app.project.devices.filter((device) => ["guest", "trusted", "mgmt"].includes(device.zone));
  const uplinkMbps = app.project.sim.uplinkMbps ?? 100;

  const pickArchetype = (id: string) => {
    setArchetypeId(id);
    const demand = defaultDemandFor(id);
    setDemandText(demand === null ? "" : String(demand));
  };

  const submitAdd = () => {
    const input = {
      name: name.trim() === "" ? (archetypes.find((item) => item.id === archetypeId)?.name ?? "Device") : name.trim(),
      archetypeId,
      zone,
      demandMbps: parseOptionalNumber(demandText),
      capMbps: parseOptionalNumber(capText)
    };
    if (Number.isNaN(input.demandMbps ?? 0)) {
      setError("demand must be a number of Mbps (or empty for the archetype default)");
      return;
    }
    if (Number.isNaN(input.capMbps ?? 0)) {
      setError("cap must be a number of Mbps (or empty for no cap)");
      return;
    }
    const probe = addDeviceToProject(cloneProject(app.project), input);
    if (!probe.ok) {
      setError(probe.error ?? "could not add the device");
      return;
    }
    app.setProject((draft) => {
      addDeviceToProject(draft, input);
    }, { clearResults: true });
    setError(null);
    setName("");
    setCapText("");
    app.setNotice(`device added → ${input.name} (${zone}) · engine rebuilt`);
  };

  const commitDemand = (device: DeviceModel, text: string) => {
    const parsed = parseOptionalNumber(text);
    if (Number.isNaN(parsed) || (parsed !== null && parsed < 0)) {
      setError(`demand for ${device.name} must be a non-negative number of Mbps`);
      return;
    }
    setError(null);
    app.setProject((draft) => {
      const target = draft.devices.find((item) => item.id === device.id);
      if (target) target.demandMbps = parsed;
    }, { clearResults: true });
    app.setNotice(`demand updated → ${device.name} ${parsed === null ? "(archetype default)" : `${parsed} Mbps`}`);
  };

  const commitCap = (device: DeviceModel, text: string) => {
    const parsed = parseOptionalNumber(text);
    if (Number.isNaN(parsed) || (parsed !== null && parsed <= 0)) {
      setError(`cap for ${device.name} must be a positive number of Mbps (or empty)`);
      return;
    }
    setError(null);
    app.setProject((draft) => {
      const target = draft.devices.find((item) => item.id === device.id);
      if (target) target.capMbps = parsed;
    }, { clearResults: true });
    app.setNotice(`bandwidth cap updated → ${device.name} ${parsed === null ? "(no cap)" : `${parsed} Mbps`}`);
  };

  const toggleCompromised = (device: DeviceModel) => {
    const next = !device.compromised;
    app.setProject((draft) => {
      const target = draft.devices.find((item) => item.id === device.id);
      if (target) target.compromised = next;
    });
    app.setNotice(`${device.name} ${next ? "marked compromised — compromised activity will run for it" : "cleared to normal"}`);
  };

  const toggleOnline = (device: DeviceModel) => {
    const live = liveDevices.find((item) => item.id === device.id);
    app.engine.setDeviceOnline(device.id, !(live?.online ?? device.online));
    bump();
  };

  const removeDevice = (device: DeviceModel) => {
    const probe = removeDeviceFromProject(cloneProject(app.project), device.id);
    if (!probe.ok) {
      setError(probe.error ?? "could not remove the device");
      return;
    }
    app.setProject((draft) => {
      removeDeviceFromProject(draft, device.id);
    }, { clearResults: true });
    setError(null);
    app.setNotice(`device removed → ${device.name} · port-forwards and incident rules referencing it were removed too`);
  };

  const setAllCompromised = (value: boolean) => {
    app.setProject((draft) => {
      for (const device of draft.devices) {
        if (["guest", "trusted", "mgmt"].includes(device.zone) && device.role === "iot") device.compromised = value;
      }
    });
    app.setNotice(value ? "all managed IoT devices marked compromised" : "all compromised flags cleared");
  };

  const commitUplink = (text: string) => {
    const parsed = parseOptionalNumber(text);
    if (parsed === null || Number.isNaN(parsed) || parsed <= 0 || parsed > 100000) {
      setError("uplink rate must be a positive number of Mbps (max 100000)");
      return;
    }
    setError(null);
    app.setProject((draft) => {
      draft.sim.uplinkMbps = parsed;
    }, { clearResults: true });
    app.setNotice(`uplink rate updated → ${parsed} Mbps`);
  };

  return (
    <div className="page">
      <h2>Devices — add IoT hardware, set demand and bandwidth caps</h2>
      <p className="meta">
        Devices added here join the sample project as fully simulated IoT nodes: they get an address from their zone,
        a hardware-testing MAC, the archetype&apos;s services and vendor endpoints, and an activity profile used by the
        activity page. Every edit rebuilds the engine and clears stale run results. <Chip tone="muted">assumption</Chip>
      </p>

      <Pane title="[add device]" right={<span className="meta">{archetypes.length} IoT archetypes</span>}>
        <div className="formrow">
          <label>
            archetype
            <select value={archetypeId} onChange={(event) => pickArchetype(event.target.value)}>
              {archetypes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            zone
            <select value={zone} onChange={(event) => setZone(event.target.value as ZoneId)}>
              {ZONE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            name
            <input value={name} placeholder={archetypes.find((item) => item.id === archetypeId)?.name ?? "Device"} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            demand Mbps
            <input value={demandText} onChange={(event) => setDemandText(event.target.value)} title="expected average consumption used by the activity generator (empty = archetype default)" />
          </label>
          <label>
            cap Mbps
            <input value={capText} placeholder="none" onChange={(event) => setCapText(event.target.value)} title="configured per-device cap — a target; stock firmware cannot shape bandwidth" />
          </label>
          <button onClick={submitAdd}>add device</button>
        </div>
        <p className="meta">
          Zone <strong>guest</strong> is the live SoftAP network; <strong>trusted</strong> and <strong>mgmt</strong> are
          logical zones whose interfaces start down (traffic from them is dropped as &quot;no route&quot; until you bring the
          interface up on the hardware page). Addresses are allocated automatically outside the DHCP pool.
        </p>
        {error ? <p className="error">{error}</p> : null}
      </Pane>

      <Pane
        title={`[managed devices] ${managed.length}`}
        right={
          <div className="row">
            <button onClick={() => setAllCompromised(true)}>mark all compromised</button>
            <button onClick={() => setAllCompromised(false)}>clear compromised</button>
          </div>
        }
      >
        <table className="table">
          <thead>
            <tr>
              <th>device</th>
              <th>zone</th>
              <th>ipv4</th>
              <th>iface</th>
              <th>demand Mbps</th>
              <th>cap Mbps</th>
              <th>state</th>
              <th>actions</th>
            </tr>
          </thead>
          <tbody>
            {managed.map((device) => {
              const live = liveDevices.find((item) => item.id === device.id);
              const online = live?.online ?? device.online;
              const defaultDemand = device.demandMbps === undefined || device.demandMbps === null ? effectiveDemandMbps(device) : null;
              return (
                <tr key={device.id}>
                  <td>
                    <div>
                      {device.name} {device.isRouter ? <Chip tone="accent">router under study</Chip> : null}
                    </div>
                    <div className="meta">
                      {device.id} · {device.trafficProfileId}
                    </div>
                  </td>
                  <td>
                    <Chip tone="muted">{device.zone}</Chip>
                  </td>
                  <td className="meta">{device.ipv4 ?? "—"}</td>
                  <td className="meta">{device.interfaceId ?? "—"}</td>
                  <td>
                    {device.role === "iot" ? (
                      <>
                        <input
                          key={`${device.id}:demand:${device.demandMbps ?? "auto"}`}
                          className="num"
                          defaultValue={device.demandMbps ?? ""}
                          placeholder={defaultDemand !== null ? String(Number(defaultDemand.toFixed(3))) : "auto"}
                          title="commit on blur/Enter — empty restores the archetype default"
                          onBlur={(event) => commitDemand(device, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                          }}
                        />
                        {defaultDemand !== null ? <div className="meta">default {Number(defaultDemand.toFixed(3))}</div> : null}
                      </>
                    ) : (
                      <span className="meta" title="infrastructure devices are not activity candidates">
                        —
                      </span>
                    )}
                  </td>
                  <td>
                    {device.role === "iot" ? (
                      <>
                        <input
                          key={`${device.id}:cap:${device.capMbps ?? "none"}`}
                          className="num"
                          defaultValue={device.capMbps ?? ""}
                          placeholder="none"
                          title="configured cap — a target; this firmware cannot shape bandwidth (see activity page)"
                          onBlur={(event) => commitCap(device, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                          }}
                        />
                        {device.capMbps !== null && device.capMbps !== undefined && (device.demandMbps ?? effectiveDemandMbps(device)) > device.capMbps ? (
                          <div className="meta">
                            <Chip tone="warn">demand above cap</Chip>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="meta">—</span>
                    )}
                  </td>
                  <td>
                    <Chip tone={online ? "ok" : "muted"}>{online ? "online" : "offline"}</Chip>{" "}
                    {device.compromised ? <Chip tone="danger">compromised</Chip> : null}
                    <div className="row" style={{ marginTop: 4 }}>
                      <button onClick={() => toggleOnline(device)}>{online ? "take offline" : "bring online"}</button>
                      <label className="check" title="compromised devices run the compromised activity profile (C2 beacon, DNS tunnel, LAN scan, exfiltration)">
                        <input type="checkbox" checked={device.compromised} onChange={() => toggleCompromised(device)} /> compromised
                      </label>
                    </div>
                  </td>
                  <td>
                    {isRemovableDevice(device) ? (
                      <button onClick={() => removeDevice(device)}>remove</button>
                    ) : (
                      <span className="meta" title="router, gateway and external hosts are protected">
                        protected
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="meta">
          Online is an engine-level control (survives until the engine rebuilds); demand, caps and the compromised flag
          persist in the project file. <Chip tone="muted">measured</Chip>
        </p>
      </Pane>

      <Pane title="[uplink] bandwidth available to the ESP32">
        <div className="formrow">
          <label>
            uplink link rate Mbps
            <input
              key={`uplink:${uplinkMbps}`}
              className="num"
              defaultValue={uplinkMbps}
              title="the WAN link rate used for capacity accounting (LAN8720 is a 100 Mbit/s PHY)"
              onBlur={(event) => commitUplink(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              }}
            />
          </label>
          <div className="meta">
            <div>
              module: <Chip tone="accent">{adapter.name}</Chip> nominal {adapter.nominalMbps} Mbit/s <Chip tone="muted">datasheet</Chip>
            </div>
            <div>
              routed ESP32 throughput estimate: 5–15 Mbps <Chip tone="muted">estimate</Chip> — the link rate is not the
              router ceiling; the activity page compares demand against both.
            </div>
          </div>
        </div>
        <p className="meta">
          The uplink rate feeds capacity accounting on the activity page: total demand, saturation and over-subscription
          warnings. It does not shape traffic — queueing is not simulated (the model reports over-subscription instead of
          fabricating a queue). <Chip tone="muted">assumption</Chip>
        </p>
        {error ? <p className="error">{error}</p> : null}
      </Pane>
    </div>
  );
}
