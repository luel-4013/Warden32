import { useMemo, useState } from "react";
import { useApp } from "../store";
import { CATEGORY_TONE, Chip, Empty, Pane, type Tone } from "../ui";
import type { SimEngine } from "../../engine/engine";
import type { IncidentModel, IncidentSeverity, IncidentStatus } from "../../engine/incident";
import type { SimEvent } from "../../engine/types";

const SEVERITY_TONE: Record<IncidentSeverity, Tone> = { low: "muted", medium: "warn", high: "danger" };

const STATUS_TONE: Record<IncidentStatus, Tone> = { open: "warn", contained: "accent", closed: "muted" };

interface ResponseRecord {
  engine: SimEngine;
  deviceId: string;
  event: SimEvent | null;
}

interface BlockRecord {
  engine: SimEngine;
  deviceId: string;
  ok: boolean;
  message: string;
  ruleId: string | null;
}

export default function IncidentPage() {
  const app = useApp();
  const [tick, setTick] = useState(0);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [responseDeviceId, setResponseDeviceId] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formSeverity, setFormSeverity] = useState<IncidentSeverity>("medium");
  const [formDeviceId, setFormDeviceId] = useState("");
  const [response, setResponse] = useState<ResponseRecord | null>(null);
  const [block, setBlock] = useState<BlockRecord | null>(null);

  const devices = app.project.devices;
  const activeResponseId = devices.some((device) => device.id === responseDeviceId)
    ? responseDeviceId
    : devices[0]?.id ?? "";
  const incidents = app.engine.incidents.all;
  const eventsById = useMemo(() => {
    const map = new Map<number, SimEvent>();
    for (const event of app.engine.events.all) map.set(event.id, event);
    return map;
  }, [app.engine, tick]);

  const activeResponse = response && response.engine === app.engine ? response : null;
  const activeBlock = block && block.engine === app.engine ? block : null;
  const lastResponseDevice = activeResponse
    ? devices.find((device) => device.id === activeResponse.deviceId) ?? null
    : null;

  const bump = () => setTick((current) => current + 1);

  const containIncident = (incident: IncidentModel) => {
    const atMs = app.engine.now;
    const detail = (details[incident.id] ?? "").trim() || "contained from the incident console";
    const updated = app.engine.incidents.contain(incident.id, atMs, detail);
    if (updated) app.setNotice(`${updated.id} contained at ${atMs}ms`);
    bump();
  };

  const closeIncident = (incident: IncidentModel) => {
    const atMs = app.engine.now;
    const detail = (details[incident.id] ?? "").trim() || "closed from the incident console";
    const updated = app.engine.incidents.close(incident.id, atMs, detail);
    if (updated) app.setNotice(`${updated.id} closed at ${atMs}ms (closedMs ${updated.closedMs})`);
    bump();
  };

  const setQuarantined = (quarantined: boolean) => {
    if (!activeResponseId) return;
    const before = app.engine.events.lastId;
    const device = app.engine.setQuarantine(activeResponseId, quarantined);
    const events = app.engine.events.since(before);
    setResponse({
      engine: app.engine,
      deviceId: device.id,
      event: events.length > 0 ? events[events.length - 1] : null
    });
    app.setNotice(`${device.name} ${quarantined ? "quarantined" : "released from quarantine"} at ${app.engine.now}ms`);
    bump();
  };

  const blockSource = () => {
    if (!activeResponseId) return;
    const result = app.engine.addBlockRule(activeResponseId);
    setBlock({ engine: app.engine, deviceId: activeResponseId, ...result });
    bump();
  };

  const openIncident = () => {
    const title = formTitle.trim();
    if (title.length === 0) return;
    const incident = app.engine.incidents.open({
      title,
      deviceId: formDeviceId || null,
      severity: formSeverity,
      atMs: app.engine.now
    });
    setFormTitle("");
    app.setNotice(`${incident.id} opened at ${incident.openedMs}ms`);
    bump();
  };

  return (
    <div className="page">
      <h2>incident response</h2>
      <div className="card">
        <h4>
          enforcement honesty <Chip tone="warn">stock: no client isolation</Chip>{" "}
          <Chip tone="warn">stock: cannot block a source host</Chip>{" "}
          <Chip tone="accent">target: stateful quarantine</Chip>
        </h4>
        <div className="reason">
          the stock SoftAP cannot isolate clients: no client isolation exists in the ESP32 Wi-Fi driver (esp-idf
          #13781), and the stock 4-list dialect cannot block a source host because it matches destination address/port
          only. quarantine is enforced by the target stateful design; flow labels show the distinction between real
          enforcement and a simulation-side response.
        </div>
      </div>
      <Pane
        title={`incidents (${incidents.length})`}
        right={
          <span className="meta">
            {app.engine.incidents.openCount} active · engine clock {app.engine.now}ms
          </span>
        }
      >
        {incidents.length === 0 ? (
          <Empty text="no incidents recorded — nothing opens incidents automatically; use the form below or follow up a scenario run with the device response tools" />
        ) : null}
        {incidents.map((incident) => {
          const device = devices.find((entry) => entry.id === incident.deviceId) ?? null;
          return (
            <article key={incident.id} className="card">
              <h4>
                {incident.id} · {incident.title} <Chip tone={SEVERITY_TONE[incident.severity]}>{incident.severity}</Chip>{" "}
                <Chip tone={STATUS_TONE[incident.status]}>{incident.status}</Chip>
              </h4>
              <div className="meta">
                device: {device ? `${device.name} (${incident.deviceId})` : incident.deviceId ?? "—"} · opened{" "}
                {incident.openedMs}ms
                {incident.closedMs !== null ? ` · closed ${incident.closedMs}ms` : ""} · {incident.evidence.length}{" "}
                evidence event(s) · {incident.actions.length} action(s)
              </div>
              {incident.evidence.length > 0 ? (
                <div className="vendors">
                  <h5>evidence</h5>
                  {incident.evidence.map((eventId, index) => {
                    const event = eventsById.get(eventId);
                    if (!event) {
                      return (
                        <div key={`${eventId}-${index}`} className="row" style={{ gap: 6, marginBottom: 2 }}>
                          <Chip tone="warn">missing</Chip>
                          <span className="meta">event #{eventId} is no longer in the event buffer</span>
                        </div>
                      );
                    }
                    return (
                      <div key={`${eventId}-${index}`} className="row" style={{ gap: 6, marginBottom: 2 }}>
                        <Chip tone={CATEGORY_TONE[event.category] ?? ""}>{event.category}</Chip>
                        <span className="meta">
                          #{event.id} · {event.ts}ms
                        </span>
                        <span className="reason" style={{ flex: 1 }}>
                          {event.message}
                        </span>
                        <Chip tone="muted">{event.provenance}</Chip>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {incident.actions.length > 0 ? (
                <div className="vendors">
                  <h5>actions</h5>
                  {incident.actions.map((action, index) => (
                    <div key={`${action.atMs}-${index}`} className="meta">
                      {action.atMs}ms · {action.kind} · {action.detail}
                    </div>
                  ))}
                </div>
              ) : null}
              {incident.status !== "closed" ? (
                <div className="row" style={{ marginTop: 6 }}>
                  <input
                    className="input"
                    style={{ flex: 1, minWidth: 180 }}
                    placeholder="response detail (optional — a default is recorded)"
                    value={details[incident.id] ?? ""}
                    onChange={(event) =>
                      setDetails((current) => ({ ...current, [incident.id]: event.target.value }))
                    }
                  />
                  <button
                    disabled={incident.status === "contained"}
                    title={
                      incident.status === "contained"
                        ? "already contained"
                        : "mark contained at the current engine time"
                    }
                    onClick={() => containIncident(incident)}
                  >
                    contain
                  </button>
                  <button onClick={() => closeIncident(incident)}>close</button>
                </div>
              ) : null}
            </article>
          );
        })}
      </Pane>
      <Pane
        title="device response"
        right={
          <Chip tone={app.engine.firmware.acl === "stateful-default-deny" ? "accent" : "warn"}>
            {app.engine.firmware.id}
          </Chip>
        }
      >
        <div className="row">
          <select value={activeResponseId} onChange={(event) => setResponseDeviceId(event.target.value)}>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name} · {device.zone}
                {device.quarantined ? " · quarantined" : ""}
              </option>
            ))}
          </select>
          <button disabled={!activeResponseId} onClick={() => setQuarantined(true)}>
            quarantine
          </button>
          <button disabled={!activeResponseId} onClick={() => setQuarantined(false)}>
            release
          </button>
          <button disabled={!activeResponseId} onClick={blockSource}>
            block source
          </button>
        </div>
        <p className="reason" style={{ marginTop: 6 }}>
          quarantine drops every flow of the selected device in the engine (simulation response) — on stock firmware a
          client cannot really be isolated. block source inserts a stateful rule only when the active dialect supports
          it; on stock the refusal is shown verbatim.
        </p>
        {lastResponseDevice ? (
          <div className="meta">
            last response device: {lastResponseDevice.name} ({lastResponseDevice.id}) · quarantined:{" "}
            {lastResponseDevice.quarantined ? "yes" : "no"} · ip {lastResponseDevice.ipv4 ?? "—"}
          </div>
        ) : null}
        {activeResponse?.event ? (
          <div className="reason">
            engine event #{activeResponse.event.id} · {activeResponse.event.message}{" "}
            <Chip tone="muted">{activeResponse.event.provenance}</Chip>
          </div>
        ) : null}
        {activeBlock ? (
          <div className="card" style={{ marginTop: 6, marginBottom: 0 }}>
            <div className="meta">
              addBlockRule("{activeBlock.deviceId}") → ok: {activeBlock.ok ? "true" : "false"} · ruleId:{" "}
              {activeBlock.ruleId ?? "null"}
            </div>
            <div className="reason">{activeBlock.message}</div>
          </div>
        ) : null}
      </Pane>
      <Pane title="open incident">
        <div className="row">
          <input
            className="input"
            style={{ flex: 1, minWidth: 220 }}
            placeholder="incident title (required)"
            value={formTitle}
            onChange={(event) => setFormTitle(event.target.value)}
          />
          <select value={formSeverity} onChange={(event) => setFormSeverity(event.target.value as IncidentSeverity)}>
            <option value="low">low severity</option>
            <option value="medium">medium severity</option>
            <option value="high">high severity</option>
          </select>
          <select value={formDeviceId} onChange={(event) => setFormDeviceId(event.target.value)}>
            <option value="">no device</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
          <button className="primary" disabled={formTitle.trim().length === 0} onClick={openIncident}>
            open
          </button>
        </div>
        <p className="meta" style={{ marginTop: 6 }}>
          opens at engine time {app.engine.now}ms with the chosen severity and device; evidence can be attached
          separately via incidents.addEvidence when a flow produces events.
        </p>
      </Pane>
    </div>
  );
}
