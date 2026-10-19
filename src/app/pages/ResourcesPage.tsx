import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../store";
import { CATEGORY_TONE, Chip, Empty, KV, Pane } from "../ui";
import {
  FAILURE_INJECTIONS,
  injectFailure,
  type FailureInjection,
  type FailureResult
} from "../../engine/failures";
import {
  AIRTIME_UNITS_PER_SECOND,
  CPU_UNITS_PER_SECOND,
  RAM_BASE_KB,
  RAM_PER_BUFFER_KB,
  RAM_PER_CONNECTION_KB,
  RAM_PER_NAPT_KB,
  TX_DRAIN_PER_SECOND,
  WINDOW_MS,
  type ResourceSnapshot
} from "../../engine/resources";

function percent(used: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.round((used / capacity) * 1000) / 10;
}

function fillClass(pct: number): string {
  if (pct >= 90) return "danger";
  if (pct >= 70) return "warn";
  return "";
}

const RAM_MODEL = `${RAM_BASE_KB} KB base + ${RAM_PER_CONNECTION_KB} KB/connection + ${RAM_PER_NAPT_KB} KB/NAPT mapping + ${RAM_PER_BUFFER_KB} KB/queued buffer`;

const NOT_INJECTABLE_PREFIX = "Not injectable: ";

function blockReason(injection: FailureInjection): string | null {
  return injection.description.startsWith(NOT_INJECTABLE_PREFIX)
    ? injection.description.slice(NOT_INJECTABLE_PREFIX.length)
    : null;
}

function GaugeCard({
  title,
  pct,
  rows,
  note
}: {
  title: ReactNode;
  pct: number;
  rows: { k: string; v: ReactNode }[];
  note: string;
}) {
  return (
    <div className="card">
      <h4>{title}</h4>
      <div className="gauge">
        <div className={`gauge-fill ${fillClass(pct)}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <div style={{ marginTop: 6 }}>
        {rows.map((row) => (
          <KV key={row.k} k={row.k} v={row.v} />
        ))}
      </div>
      <div className="meta">{note}</div>
    </div>
  );
}

export default function ResourcesPage() {
  const app = useApp();
  const [snapshot, setSnapshot] = useState<ResourceSnapshot>(() => app.engine.resourceSnapshot());
  const [tick, setTick] = useState(0);
  const [failureResults, setFailureResults] = useState<Record<string, FailureResult>>({});

  useEffect(() => {
    setSnapshot(app.engine.resourceSnapshot());
  }, [app.engine]);

  const refresh = () => {
    setSnapshot(app.engine.resourceSnapshot());
    setTick((current) => current + 1);
  };

  const inject = (id: string) => {
    const result = injectFailure(app.engine, id);
    setFailureResults((current) => ({ ...current, [id]: result }));
    refresh();
  };

  const ramPct = percent(snapshot.ramUsedKb, snapshot.ramLimitKb);
  const ramClamped = snapshot.ramLimitKb !== app.engine.board.ramKb;
  const cpuUnits = Math.round((snapshot.cpuLoadPct / 100) * CPU_UNITS_PER_SECOND * 100) / 100;
  const airtimeUnits = Math.round((snapshot.airtimePct / 100) * AIRTIME_UNITS_PER_SECOND * 100) / 100;
  const conntrackPct = percent(snapshot.conntrackUsed, snapshot.conntrackCapacity);
  const naptPct = percent(snapshot.naptUsed, snapshot.naptCapacity);
  const txPct = percent(snapshot.txQueueDepth, snapshot.txQueueCapacity);
  const tail = [...app.engine.events.byCategory("resource"), ...app.engine.events.byCategory("system")]
    .sort((a, b) => b.id - a.id)
    .slice(0, 10);

  return (
    <div className="page">
      <h2>resources &amp; failure injection</h2>
      <p className="meta">
        Model gauges read from the live engine; RAM/CPU/airtime/tx figures are simulation estimates from engine
        constants (provenance: estimate), table occupancy is counted by the engine. No measured hardware values.
      </p>
      <div className="row">
        <button className="primary" onClick={refresh}>
          refresh snapshot
        </button>
        <Chip tone="muted">{snapshot.provenance}</Chip>
        <span className="meta">
          tick {tick} · events {app.engine.events.count} · {app.engine.firmware.name} · link {app.engine.adapter.name}
        </span>
      </div>

      <div className="grid3">
        <GaugeCard
          title={
            <>
              RAM heap <Chip tone="muted">estimate</Chip>{" "}
              {snapshot.ramExhausted ? <Chip tone="danger">heap exhausted</Chip> : null}
            </>
          }
          pct={ramPct}
          rows={[
            { k: "used", v: `${snapshot.ramUsedKb} / ${snapshot.ramLimitKb} KB · ${ramPct}%` },
            {
              k: "limit",
              v: ramClamped ? (
                <>
                  clamped by ramOverrideKb <Chip tone="warn">assumption</Chip>
                </>
              ) : (
                <>board datasheet {app.engine.board.ramKb} KB</>
              )
            },
            { k: "model", v: RAM_MODEL },
            { k: "buffers", v: `${snapshot.buffersFree} / ${snapshot.bufferCount} free` }
          ]}
          note={`RAM model constants (engine/resources.ts): ${RAM_MODEL}; pending hardware calibration (M8).`}
        />
        <GaugeCard
          title={
            <>
              CPU — {WINDOW_MS} ms window <Chip tone="muted">estimate</Chip>{" "}
              {snapshot.cpuLoadPct > 100 ? <Chip tone="danger">saturated</Chip> : null}
            </>
          }
          pct={snapshot.cpuLoadPct}
          rows={[
            { k: "load", v: `${snapshot.cpuLoadPct}%` },
            { k: "units", v: `${cpuUnits} / ${CPU_UNITS_PER_SECOND} cost units per ${WINDOW_MS} ms` }
          ]}
          note="Above 100% the engine only labels saturation — real firmware would add latency, not drop packets."
        />
        <GaugeCard
          title={
            <>
              airtime — {WINDOW_MS} ms window <Chip tone="muted">estimate</Chip>
            </>
          }
          pct={snapshot.airtimePct}
          rows={[
            { k: "load", v: `${snapshot.airtimePct}%` },
            { k: "units", v: `${airtimeUnits} / ${AIRTIME_UNITS_PER_SECOND} airtime units per ${WINDOW_MS} ms` }
          ]}
          note="Relative radio-airtime model shared with the Wi-Fi uplink; routed Ethernet, Wi-Fi and L2-relay flows cost different units."
        />
        <GaugeCard
          title={
            <>
              TX queue + buffers <Chip tone="muted">estimate</Chip>
            </>
          }
          pct={txPct}
          rows={[
            { k: "queued", v: `${snapshot.txQueueDepth} / ${snapshot.txQueueCapacity} · ${txPct}%` },
            { k: "drain", v: `${TX_DRAIN_PER_SECOND} frames/s` },
            { k: "buffers", v: `${snapshot.buffersFree} / ${snapshot.bufferCount} free` }
          ]}
          note="Depth is engine-tracked; overflow past capacity drops the offending flow (buffer-exhaustion estimate)."
        />
        <GaugeCard
          title={
            <>
              conntrack <Chip tone="muted">measured</Chip>
            </>
          }
          pct={conntrackPct}
          rows={[
            { k: "entries", v: `${snapshot.conntrackUsed} / ${snapshot.conntrackCapacity} · ${conntrackPct}%` }
          ]}
          note="Connection-table occupancy counted by the engine; capacity binds when the engine is built (M6)."
        />
        <GaugeCard
          title={
            <>
              NAPT mappings <Chip tone="muted">measured</Chip>
            </>
          }
          pct={naptPct}
          rows={[{ k: "mappings", v: `${snapshot.naptUsed} / ${snapshot.naptCapacity} · ${naptPct}%` }]}
          note="Guest + upstream NAT entries. Capacity binds at engine build — the napt-exhaustion injection applies on rebuild."
        />
      </div>

      <Pane
        title="[failure injections]"
        right={<span className="meta">one-shot presets — re-inject to repeat; effects persist until the engine is rebuilt</span>}
      >
        <table className="table">
          <thead>
            <tr>
              <th>injection</th>
              <th>description</th>
              <th>action</th>
              <th>result</th>
            </tr>
          </thead>
          <tbody>
            {FAILURE_INJECTIONS.map((injection) => {
              const reason = blockReason(injection);
              const result = failureResults[injection.id];
              return (
                <tr key={injection.id}>
                  <td>
                    {injection.name}
                    <div className="meta">
                      {injection.id} <Chip tone="muted">assumption</Chip>
                    </div>
                  </td>
                  <td>{injection.description}</td>
                  <td>
                    {reason ? (
                      <button disabled title={reason}>
                        not injectable
                      </button>
                    ) : (
                      <button onClick={() => inject(injection.id)}>inject</button>
                    )}
                  </td>
                  <td>
                    {result ? (
                      <span className={result.ok ? "tone-ok" : "tone-warn"}>{result.message}</span>
                    ) : (
                      <span className="meta">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Pane>

      <div className="grid2">
        <Pane title="[interfaces — link state]">
          <p className="meta">
            setLinkState flips the live interface; routes are derived from up interfaces at runtime (engine assumption
            provenance).
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>interface</th>
                <th>kind</th>
                <th>zone</th>
                <th>address</th>
                <th>state</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {app.engine.project.interfaces.map((iface) => (
                <tr key={iface.id}>
                  <td>
                    {iface.id}
                    <div className="meta">{iface.name}</div>
                  </td>
                  <td>{iface.kind}</td>
                  <td>{iface.zone}</td>
                  <td>{iface.ipv4 ? `${iface.ipv4}/${iface.prefix}` : "—"}</td>
                  <td>
                    <Chip tone={iface.up ? "ok" : "danger"}>{iface.up ? "up" : "down"}</Chip>
                  </td>
                  <td>
                    <button
                      onClick={() => {
                        app.engine.setLinkState(iface.id, !iface.up);
                        refresh();
                      }}
                    >
                      {iface.up ? "bring down" : "bring up"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Pane>

        <Pane title="[devices — online state]">
          <p className="meta">
            setDeviceOnline flips the live device; offline endpoints drop their flows with a "device offline" reason.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>device</th>
                <th>zone</th>
                <th>role</th>
                <th>address</th>
                <th>state</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {app.engine.project.devices.map((device) => (
                <tr key={device.id}>
                  <td>
                    {device.name}
                    <div className="meta">{device.id}</div>
                  </td>
                  <td>{device.zone}</td>
                  <td>{device.role}</td>
                  <td>{device.ipv4 ?? "—"}</td>
                  <td>
                    <Chip tone={device.online ? "ok" : "danger"}>{device.online ? "online" : "offline"}</Chip>
                  </td>
                  <td>
                    <button
                      onClick={() => {
                        app.engine.setDeviceOnline(device.id, !device.online);
                        refresh();
                      }}
                    >
                      {device.online ? "take offline" : "bring online"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Pane>
      </div>

      <Pane title="[recent system / resource events]">
        {tail.length === 0 ? (
          <Empty text="no system or resource events yet — snapshot refresh, injections and toggles emit here" />
        ) : (
          tail.map((event) => (
            <div key={event.id} className="row" style={{ gap: 6, marginBottom: 3 }}>
              <Chip tone={CATEGORY_TONE[event.category] ?? ""}>{event.category}</Chip>
              <span className="meta" style={{ minWidth: 54 }}>
                {event.ts}ms
              </span>
              <span className="reason" style={{ flex: 1 }}>
                {event.message}
              </span>
              <Chip tone="muted">{event.provenance}</Chip>
            </div>
          ))
        )}
      </Pane>
    </div>
  );
}
