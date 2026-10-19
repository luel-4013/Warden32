import { useState } from "react";
import type { ActivityMode, ActivityReport } from "../../engine/activity";
import { initialActivityMode, useApp } from "../store";
import { Chip, Empty, Pane, VERDICT_TONE } from "../ui";

const WINDOWS: { id: string; label: string; ms: number }[] = [
  { id: "5m", label: "5 minutes", ms: 300_000 },
  { id: "1h", label: "1 hour", ms: 3_600_000 },
  { id: "6h", label: "6 hours", ms: 21_600_000 },
  { id: "24h", label: "24 hours", ms: 86_400_000 }
];

const MODES: { id: ActivityMode; label: string; hint: string }[] = [
  { id: "states", label: "use device states", hint: "compromised devices run the compromised profile, others run normal" },
  { id: "normal", label: "force normal", hint: "every device runs its normal activity profile" },
  { id: "compromised", label: "force compromised", hint: "every device runs the compromised activity profile" }
];

function mb(bytes: number): string {
  return (bytes / 1_000_000).toFixed(2);
}

function windowLabel(ms: number): string {
  const item = WINDOWS.find((w) => w.ms === ms);
  return item ? item.label : `${(ms / 3_600_000).toFixed(1)} h`;
}

function reportToCsv(report: ActivityReport, nameOf: (id: string) => string): string {
  const lines: string[] = [
    "kind,device_id,device,zone,state,demand_mbps,cap_mbps,over_cap,activity_id,activity,target,flows,bytes,allowed_bytes,consumed_mbps,peak_mbps"
  ];
  for (const device of report.devices) {
    lines.push(
      [
        "device",
        device.deviceId,
        `"${device.name}"`,
        device.zone,
        device.state,
        device.demandMbps,
        device.capMbps ?? "",
        device.overCap ? "yes" : "no",
        "",
        "",
        "",
        device.flows,
        device.bytesAttempted,
        device.bytesAllowed,
        device.consumedMbps.toFixed(4),
        device.peakMbps.toFixed(4)
      ].join(",")
    );
    for (const activity of device.activities) {
      lines.push(
        [
          "activity",
          device.deviceId,
          `"${device.name}"`,
          device.zone,
          device.state,
          "",
          "",
          "",
          activity.activityId,
          `"${activity.label}"`,
          `"${nameOf(activity.targetDeviceId)}"`,
          activity.flows,
          activity.bytes,
          activity.allowedBytes,
          "",
          ""
        ].join(",")
      );
    }
  }
  return lines.join("\n");
}

function reportToMarkdown(report: ActivityReport, nameOf: (id: string) => string): string {
  const lines: string[] = [];
  lines.push("# Warden32 activity report");
  lines.push("");
  lines.push(`- mode: ${report.mode}`);
  lines.push(`- window: ${windowLabel(report.windowMs)} (${report.startMs}ms → ${report.endMs}ms of engine time)`);
  lines.push(`- seed: ${report.seed}`);
  lines.push(`- flows evaluated: ${report.totals.flows}`);
  lines.push(`- data attempted: ${mb(report.totals.bytesAttempted)} MB · allowed: ${mb(report.totals.bytesAllowed)} MB`);
  lines.push(`- consumed average: ${report.totals.consumedMbps.toFixed(3)} Mbps`);
  lines.push(
    `- verdicts: allowed ${report.totals.allowed} · denied ${report.totals.denied} · dropped ${report.totals.dropped} · not-enforceable ${report.totals.notEnforceable}`
  );
  lines.push("");
  lines.push("## capacity");
  lines.push("");
  lines.push(`- uplink link rate: ${report.capacity.uplinkMbps} Mbps (configured)`);
  lines.push(`- total demand: ${report.capacity.totalDemandMbps.toFixed(3)} Mbps · consumed ${report.capacity.totalConsumedMbps.toFixed(3)} Mbps`);
  lines.push(`- saturation: ${report.capacity.saturationPct.toFixed(1)}% of the link rate${report.capacity.overSubscribed ? " — OVER-SUBSCRIBED" : ""}`);
  lines.push(
    `- ESP32 routed throughput estimate: ${report.capacity.firmwareThroughputMbps[0]}–${report.capacity.firmwareThroughputMbps[1]} Mbps (estimate)`
  );
  lines.push(`- caps: not enforceable — ${report.capacity.capNote}`);
  lines.push("");
  lines.push("## devices");
  lines.push("");
  lines.push("| device | zone | state | demand Mbps | cap Mbps | consumed Mbps | peak Mbps | attempted MB | allowed MB |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const device of report.devices) {
    lines.push(
      `| ${device.name} | ${device.zone} | ${device.state} | ${device.demandMbps} | ${device.capMbps ?? "—"} | ${device.consumedMbps.toFixed(3)} | ${device.peakMbps.toFixed(3)} | ${mb(device.bytesAttempted)} | ${mb(device.bytesAllowed)} |`
    );
  }
  lines.push("");
  lines.push("## per-activity breakdown");
  lines.push("");
  lines.push("| device | activity | target | flows | MB attempted | MB allowed |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const device of report.devices) {
    for (const activity of device.activities) {
      lines.push(
        `| ${device.name} | ${activity.label} | ${nameOf(activity.targetDeviceId)} | ${activity.flows} | ${mb(activity.bytes)} | ${mb(activity.allowedBytes)} |`
      );
    }
  }
  lines.push("");
  lines.push("## notes");
  lines.push("");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}

export default function ActivityPage() {
  const app = useApp();
  const [windowId, setWindowId] = useState("1h");
  const [mode, setMode] = useState<ActivityMode>(initialActivityMode);
  const [seedText, setSeedText] = useState(String(app.project.sim.seed));
  const report = app.activity;

  const nameOf = (id: string) => app.project.devices.find((device) => device.id === id)?.name ?? id;

  const run = () => {
    const windowMs = WINDOWS.find((w) => w.id === windowId)?.ms ?? 3_600_000;
    const seedValue = Number(seedText);
    const seed = Number.isFinite(seedValue) ? Math.floor(seedValue) : app.project.sim.seed;
    app.runActivity(mode, windowMs, seed);
  };

  const candidates = app.project.devices.filter(
    (device) => device.role === "iot" && !device.isRouter && !device.gateway && ["guest", "trusted", "mgmt"].includes(device.zone)
  );
  const compromisedCount = candidates.filter((device) => device.compromised).length;

  return (
    <div className="page">
      <h2>Activity — normal and compromised IoT behaviour with bandwidth accounting</h2>
      <p className="meta">
        Generates deterministic, volume-based activity for every managed IoT device: each device&apos;s activities
        (updates, telemetry, streaming, DNS/NTP, local polling) are sized from its configured demand, scheduled with
        seeded jitter, and evaluated through the real engine — verdicts, NAT and drops are the same pipeline as manual
        flows. Compromised devices run C2 beaconing, DNS tunneling, LAN scanning and exfiltration instead.{" "}
        <Chip tone="muted">estimate</Chip>
      </p>

      <Pane
        title="[run]"
        right={
          <span className="meta">
            {candidates.length} device(s) in scope · {compromisedCount} compromised
          </span>
        }
      >
        <div className="formrow">
          <label>
            window
            <select value={windowId} onChange={(event) => setWindowId(event.target.value)}>
              {WINDOWS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            mode
            <select value={mode} onChange={(event) => setMode(event.target.value as ActivityMode)}>
              {MODES.map((item) => (
                <option key={item.id} value={item.id} title={item.hint}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            seed
            <input key={`seed:${app.project.sim.seed}`} className="num" defaultValue={seedText} onChange={(event) => setSeedText(event.target.value)} />
          </label>
          <button className="primary" onClick={run} disabled={candidates.length === 0}>
            run activity
          </button>
        </div>
        <p className="meta">
          Same seed + same device set always produce identical flows (engine determinism). Time advances during a run —
          consecutive runs continue the engine clock. Switch device states on the devices page or with the compromise
          toggles there. <Chip tone="muted">measured</Chip>
        </p>
      </Pane>

      {report === null ? (
        <Pane title="[report]">
          <Empty text='no activity run yet — pick a window and press "run activity". Tip: mark a device compromised on the devices page first to compare normal vs compromised behaviour.' />
        </Pane>
      ) : (
        <>
          <Pane
            title="[summary]"
            right={
              <span className="meta">
                mode {report.mode} · seed {report.seed} · {windowLabel(report.windowMs)} of engine time
              </span>
            }
          >
            <div className="labels">
              <Chip tone="accent">{report.totals.flows} flows</Chip>
              <Chip tone="ok">allowed {report.totals.allowed}</Chip>
              <Chip tone="danger">denied {report.totals.denied}</Chip>
              <Chip tone="danger">dropped {report.totals.dropped}</Chip>
              <Chip tone="warn">not-enforceable {report.totals.notEnforceable}</Chip>
              <Chip tone="muted">{mb(report.totals.bytesAttempted)} MB attempted</Chip>
              <Chip tone="muted">{mb(report.totals.bytesAllowed)} MB allowed</Chip>
              <Chip tone="muted">{report.totals.consumedMbps.toFixed(3)} Mbps avg consumed</Chip>
            </div>
            <div className="reason">
              engine clock after the run: {report.endMs}ms · results are stored with the run — device or bandwidth edits
              clear the report (stale results are not kept). Flow rows carry their batch size: generated flows are
              sampled representations whose byte totals equal the configured volume.
            </div>
          </Pane>

          <Pane
            title="[capacity] bandwidth to the ESP32"
            right={<Chip tone={report.capacity.overSubscribed ? "danger" : "ok"}>{report.capacity.overSubscribed ? "over-subscribed" : "within capacity"}</Chip>}
          >
            <dl className="kv">
              <dt>uplink link rate</dt>
              <dd>
                {report.capacity.uplinkMbps} Mbps <span className="meta">configured (devices page)</span>
              </dd>
              <dt>total demand</dt>
              <dd>{report.capacity.totalDemandMbps.toFixed(3)} Mbps across online devices</dd>
              <dt>total consumed</dt>
              <dd>{report.capacity.totalConsumedMbps.toFixed(3)} Mbps average after policy verdicts</dd>
              <dt>saturation</dt>
              <dd>
                <div className="meter" title="configured demand as a share of the uplink link rate">
                  <div
                    className={`fill ${report.capacity.overSubscribed ? "over" : ""}`}
                    style={{ width: `${Math.min(100, report.capacity.saturationPct)}%` }}
                  />
                </div>{" "}
                {report.capacity.saturationPct.toFixed(1)}%
              </dd>
              <dt>router ceiling</dt>
              <dd>
                {report.capacity.firmwareThroughputMbps[0]}–{report.capacity.firmwareThroughputMbps[1]} Mbps routed
                throughput <Chip tone="muted">estimate</Chip>
              </dd>
              <dt>per-device caps</dt>
              <dd>
                not enforceable <Chip tone="warn">target only</Chip>
              </dd>
            </dl>
            <div className="reason">{report.capacity.capNote}</div>
          </Pane>

          <Pane title={`[per-device accounting] ${report.devices.length} device(s)`}>
            <table className="table">
              <thead>
                <tr>
                  <th>device</th>
                  <th>state</th>
                  <th>demand Mbps</th>
                  <th>cap Mbps</th>
                  <th>attempted Mbps</th>
                  <th>consumed Mbps</th>
                  <th>peak Mbps</th>
                  <th>sent MB</th>
                  <th>recv MB</th>
                  <th>verdicts</th>
                </tr>
              </thead>
              <tbody>
                {report.devices.map((device) => (
                  <tr key={device.deviceId}>
                    <td>
                      <div>{device.name}</div>
                      <div className="meta">
                        {device.deviceId} · {device.profileId}
                      </div>
                    </td>
                    <td>
                      <Chip tone={device.state === "compromised" ? "danger" : "ok"}>{device.state}</Chip>
                      {device.offline ? <Chip tone="muted">offline</Chip> : null}
                    </td>
                    <td className="meta">{device.demandMbps.toFixed(3)}</td>
                    <td className="meta">
                      {device.capMbps ?? "—"} {device.overCap ? <Chip tone="warn">demand &gt; cap</Chip> : null}
                    </td>
                    <td className="meta">{device.attemptedMbps.toFixed(3)}</td>
                    <td className="meta">{device.consumedMbps.toFixed(3)}</td>
                    <td className="meta">{device.peakMbps.toFixed(3)}</td>
                    <td className="meta">{mb(device.bytesAttempted)}</td>
                    <td className="meta">{mb(device.bytesReceived)}</td>
                    <td>
                      <div className="labels">
                        {device.allowed > 0 ? <Chip tone={VERDICT_TONE.allowed}>ok {device.allowed}</Chip> : null}
                        {device.denied > 0 ? <Chip tone={VERDICT_TONE.denied}>den {device.denied}</Chip> : null}
                        {device.dropped > 0 ? <Chip tone={VERDICT_TONE.dropped}>drp {device.dropped}</Chip> : null}
                        {device.notEnforceable > 0 ? <Chip tone={VERDICT_TONE["not-enforceable"]}>n/e {device.notEnforceable}</Chip> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="meta">
              &quot;attempted&quot;: bytes the device sent; &quot;consumed&quot;: bytes with an allowed verdict after the full
              pipeline; &quot;recv&quot;: inbound bytes represented by other devices&apos; generated flows (e.g. scans).
              Peak is the busiest simulated minute — sampled flows are spread evenly, so peak tracks average closely.{" "}
              <Chip tone="muted">estimate</Chip>
            </p>
          </Pane>

          <Pane title="[per-activity breakdown]">
            <table className="table">
              <thead>
                <tr>
                  <th>device</th>
                  <th>activity</th>
                  <th>target</th>
                  <th>flows</th>
                  <th>MB attempted</th>
                  <th>MB allowed</th>
                </tr>
              </thead>
              <tbody>
                {report.devices.flatMap((device) =>
                  device.activities.map((activity) => (
                    <tr key={`${device.deviceId}:${activity.activityId}`}>
                      <td className="meta">{device.name}</td>
                      <td>{activity.label}</td>
                      <td className="meta">{nameOf(activity.targetDeviceId)}</td>
                      <td className="meta">{activity.flows}</td>
                      <td className="meta">{mb(activity.bytes)}</td>
                      <td className="meta">{mb(activity.allowedBytes)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Pane>

          <Pane
            title="[notes & export]"
            right={
              <div className="row">
                <button
                  onClick={() => {
                    const { results, ...rest } = report;
                    void results;
                    app.exportText("warden32-activity.json", JSON.stringify(rest, null, 2));
                  }}
                >
                  export JSON
                </button>
                <button onClick={() => app.exportText("warden32-activity.csv", reportToCsv(report, nameOf))}>export CSV</button>
                <button onClick={() => app.exportText("warden32-activity.md", reportToMarkdown(report, nameOf))}>export markdown</button>
              </div>
            }
          >
            <ul className="meta">
              {report.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </Pane>
        </>
      )}
    </div>
  );
}
