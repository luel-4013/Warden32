import { useState } from "react";
import { useApp } from "../store";
import { Chip, Empty, Pane, VERDICT_TONE, toneForLabel } from "../ui";
import type { DeviceModel } from "../../engine/model";
import type { Flow, FlowResult } from "../../engine/types";
import {
  COMPROMISE_PLAN,
  STATE_PROFILE_OVERRIDE,
  TRAFFIC_PROFILES,
  deviceState,
  generateCompromiseFlows,
  generateDeviceFlows,
  profileIdForState,
  type DeviceState
} from "../../engine/traffic";
import { DEVICE_ARCHETYPES } from "../../registry/devices";

const FLOW_COUNT = 4;
const DEVICE_STATES: DeviceState[] = ["normal", "noisy", "misconfigured", "compromised"];

const STATE_TONE: Record<DeviceState, "ok" | "warn" | "danger"> = {
  normal: "ok",
  noisy: "warn",
  misconfigured: "warn",
  compromised: "danger"
};

const ROLE_RANK: Record<string, number> = { iot: 0, infrastructure: 1, external: 2, attacker: 3 };

function resolveTarget(target: string, srcDeviceId: string, devices: DeviceModel[]): string | null {
  const exact = devices.find((device) => device.id === target && device.id !== srcDeviceId);
  if (exact) return exact.id;
  if (target === "guest-local") {
    const peer = devices.find(
      (device) => device.zone === "guest" && !device.isRouter && device.role === "iot" && device.id !== srcDeviceId
    );
    return peer ? peer.id : null;
  }
  const patterns: Record<string, RegExp> = {
    "vendor-cloud": /vendor|cloud/i,
    c2: /c2|command/i,
    "dns-server": /dns|resolver/i,
    "ntp-pool": /ntp|time/i
  };
  const pattern = patterns[target];
  if (!pattern) return null;
  const match = devices.find((device) => pattern.test(device.name) && device.id !== srcDeviceId);
  return match ? match.id : null;
}

function formatMs(ms: number): string {
  if (ms >= 60000) {
    const minutes = ms / 60000;
    return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)}min`;
  }
  if (ms >= 1000) {
    const seconds = ms / 1000;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  }
  return `${ms}ms`;
}

function formatRate(intervalMs: number): string {
  const perSecond = 1000 / intervalMs;
  return `${perSecond >= 1 ? perSecond.toFixed(2) : perSecond.toFixed(4)}/s`;
}

interface GeneratedBatch {
  key: string;
  deviceId: string;
  kind: "profile" | "compromise";
  profileId: string;
  startMs: number;
  note: string;
  results: FlowResult[];
}

export default function TrafficPage() {
  const app = useApp();
  const [, setTick] = useState(0);
  const [batches, setBatches] = useState<GeneratedBatch[]>([]);
  const bump = () => setTick((value) => value + 1);

  const devices = [...app.project.devices].sort(
    (a, b) => (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9) || a.id.localeCompare(b.id)
  );
  const liveDevices = app.engine.project.devices;
  const nameOf = (id: string) => liveDevices.find((device) => device.id === id)?.name ?? id;

  const setBehavior = (deviceId: string, next: DeviceState) => {
    app.setProject((draft) => {
      const target = draft.devices.find((device) => device.id === deviceId);
      if (!target) return;
      if (next === "compromised") {
        target.compromised = true;
      } else {
        target.compromised = false;
        target.behaviorState = next;
      }
    });
    app.setNotice("rerun the battery to see new verdicts");
  };

  const toggleOnline = (device: DeviceModel) => {
    const live = liveDevices.find((item) => item.id === device.id);
    app.engine.setDeviceOnline(device.id, !(live?.online ?? device.online));
    bump();
  };

  const runGenerator = (device: DeviceModel, kind: "profile" | "compromise") => {
    const state = deviceState(device);
    const effectiveProfile = profileIdForState(device, state);
    const startMs = app.engine.now;
    const base = {
      count: FLOW_COUNT,
      startMs,
      seed: app.project.sim.seed,
      resolve: (target: string) => resolveTarget(target, device.id, liveDevices)
    };
    const flows: Flow[] =
      kind === "profile"
        ? generateDeviceFlows({ ...base, device })
        : generateCompromiseFlows({ ...base, srcDeviceId: device.id });
    const results: FlowResult[] = [];
    for (const flow of flows) {
      app.engine.advanceTo(Math.max(app.engine.now, flow.timestampMs));
      results.push(app.engine.submitFlow(flow));
    }
    const profile = TRAFFIC_PROFILES[effectiveProfile];
    const note =
      flows.length > 0
        ? ""
        : kind === "compromise"
          ? "0 flows — c2, dns-server or a guest-local peer is missing from this project"
          : effectiveProfile === "none"
            ? "0 flows — no traffic profile assigned (trafficProfileId \"none\")"
            : profile
              ? "0 flows — no target role resolved in this project (vendor-cloud, ntp-pool, dns-server, guest-local peer)"
              : `0 flows — profile "${effectiveProfile}" is not registered in TRAFFIC_PROFILES (project value); the registry archetype id was not substituted`;
    setBatches((current) => [
      ...current.filter((batch) => !(batch.deviceId === device.id && batch.kind === kind)),
      {
        key: `${device.id}:${kind}:${app.engine.now}`,
        deviceId: device.id,
        kind,
        profileId: kind === "profile" ? effectiveProfile : "compromise plan",
        startMs,
        note,
        results
      }
    ]);
    bump();
  };

  return (
    <div className="page">
      <h2>Traffic lab — deterministic per-device flow generation</h2>
      <p className="meta">
        Generators come from src/engine/traffic.ts and are seeded from the project seed — same state and seed always
        produce identical flows. Flows generated here are submitted straight to the live engine and shown below as{" "}
        <Chip tone="accent">generated here</Chip>; they are separate from the fixed sample battery in the top bar.
      </p>

      <Pane
        title="[devices]"
        right={
          <span className="meta">
            seed {app.project.sim.seed} · engine clock {app.engine.now}ms · count {FLOW_COUNT}/step
          </span>
        }
      >
        <p className="meta">
          online is an engine-level control (engine.setDeviceOnline) — it survives until the engine rebuilds (any project
          edit or firmware change); behavior and compromise state persist in the project.{" "}
          <Chip tone="muted">measured</Chip>
        </p>
        <div className="card">
          <h4>
            compromise plan — what the button submits <Chip tone="muted">assumption</Chip>
          </h4>
          <div className="reason">
            C2 beacon every {COMPROMISE_PLAN.beaconIntervalMs / 1000}s ±{COMPROMISE_PLAN.beaconJitterMs / 1000}s (
            {FLOW_COUNT}×) · {COMPROMISE_PLAN.lateralProbes} lateral probes at {COMPROMISE_PLAN.lateralIntervalMs / 1000}s
            spacing · DNS tunnel every {COMPROMISE_PLAN.dnsTunnelIntervalMs / 1000}s ±1s ({FLOW_COUNT}×). Submitting shows
            whether the active dialect can deny each flow: stock has no egress filtering (default allow) and guest-to-guest
            probes are relayed by the Wi-Fi driver — not enforceable. <Chip tone="muted">measured</Chip>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>device</th>
              <th>zone</th>
              <th>engine state</th>
              <th>effective profile</th>
              <th>online</th>
              <th>actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => {
              const live = liveDevices.find((item) => item.id === device.id);
              const current = live ?? device;
              const state = deviceState(current);
              const effectiveProfile = profileIdForState(current, state);
              const profile = TRAFFIC_PROFILES[effectiveProfile];
              const override = state === "compromised" ? null : STATE_PROFILE_OVERRIDE[state];
              const archetype = DEVICE_ARCHETYPES.find((item) => item.name === device.name);
              return (
                <tr key={device.id}>
                  <td>
                    <div>{device.name}</div>
                    <div className="meta">
                      {device.id} · {device.role}
                    </div>
                  </td>
                  <td>
                    <Chip tone="muted">{device.zone}</Chip>
                  </td>
                  <td>
                    <Chip tone={STATE_TONE[state]}>{state}</Chip>
                    <div className="row" style={{ marginTop: 4 }}>
                      <select
                        value={state}
                        title="project behaviorState + compromised flag, committed through setProject"
                        onChange={(event) => setBehavior(device.id, event.target.value as DeviceState)}
                      >
                        {DEVICE_STATES.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="meta">
                      behaviorState {device.behaviorState}
                      {device.compromised ? " · compromised flag set" : ""}
                    </div>
                  </td>
                  <td>
                    <Chip tone={profile ? "accent" : "danger"}>{effectiveProfile}</Chip>
                    {override ? <div className="meta">state override → {override}</div> : null}
                    {state === "compromised" ? (
                      <div className="meta">base profile retained; compromise flows appended by the generator</div>
                    ) : null}
                    {!profile ? (
                      <div className="meta">
                        not registered in TRAFFIC_PROFILES
                        {archetype
                          ? ` — registry archetype ${archetype.id} lists ${archetype.trafficProfileId} (informational, not substituted)`
                          : ""}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <Chip tone={current.online ? "ok" : "muted"}>{current.online ? "online" : "offline"}</Chip>
                    <div>
                      <button onClick={() => toggleOnline(device)}>
                        {current.online ? "take offline" : "bring online"}
                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="row">
                      <button onClick={() => runGenerator(device, "profile")}>generate flows</button>
                      <button
                        disabled={state !== "compromised"}
                        title={
                          state === "compromised"
                            ? "submit the compromise plan — C2 beacon, lateral probes, DNS tunnel"
                            : "only meaningful when engine state is compromised"
                        }
                        onClick={() => runGenerator(device, "compromise")}
                      >
                        compromise plan
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Pane>

      <Pane
        title={`[generated flows] ${batches.length} batch(es)`}
        right={batches.length > 0 ? <button onClick={() => setBatches([])}>clear generated</button> : undefined}
      >
        {batches.length === 0 ? (
          <Empty text="no generated flows yet — use generate flows / compromise plan above" />
        ) : (
          batches.map((batch) => {
            const counts: Record<string, number> = { allowed: 0, denied: 0, dropped: 0, "not-enforceable": 0 };
            for (const result of batch.results) counts[result.verdict] += 1;
            const device = devices.find((item) => item.id === batch.deviceId);
            return (
              <div key={batch.key} className="card">
                <h4>
                  {device?.name ?? batch.deviceId} — {batch.kind === "compromise" ? "compromise plan" : "traffic profile"}{" "}
                  <Chip tone="accent">generated here</Chip> <Chip tone="muted">{batch.profileId}</Chip>{" "}
                  <Chip tone="muted">seed {app.project.sim.seed}</Chip>
                </h4>
                <div className="meta">
                  {batch.results.length} flow(s) submitted from {batch.startMs}ms · clock now {app.engine.now}ms ·
                  verified against this engine build — project edits rebuild the engine
                </div>
                <div className="labels">
                  {(["allowed", "denied", "dropped", "not-enforceable"] as const).map((verdict) =>
                    counts[verdict] > 0 ? (
                      <Chip key={verdict} tone={VERDICT_TONE[verdict]}>
                        {verdict} {counts[verdict]}
                      </Chip>
                    ) : null
                  )}
                </div>
                {batch.results.length === 0 ? <Empty text={batch.note} /> : null}
                {batch.results.map((result) => (
                  <div key={result.flow.id} style={{ marginTop: 6 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <Chip tone={VERDICT_TONE[result.verdict]}>{result.verdict}</Chip>
                      <span className="reason">{result.flow.label}</span>
                      <span className="meta">
                        {result.flow.protocol}
                        {result.flow.dstPort !== null ? `:${result.flow.dstPort}` : ""} →{" "}
                        {nameOf(result.flow.dstDeviceId)}
                      </span>
                      <span className="meta">
                        {result.scope} · {result.enforcementPoint} · fw sees:{" "}
                        {result.visibleToFirewall ? "yes" : "no"}
                      </span>
                    </div>
                    <div className="reason">{result.reason}</div>
                    {result.labels.length > 0 ? (
                      <div className="labels">
                        {result.labels.map((label) => (
                          <Chip key={label} tone={toneForLabel(label)}>
                            {label}
                          </Chip>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            );
          })
        )}
      </Pane>

      <Pane title="[profiles catalog]" right={<span className="meta">{Object.keys(TRAFFIC_PROFILES).length} profiles</span>}>
        <p className="meta">
          Targets are role ids resolved at generation time against the project (exact device id first, then zone/name
          match). Rate and run-span values are derived estimates for count {FLOW_COUNT} per step; jitter is excluded.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>profile</th>
              <th>steps (proto/port → target)</th>
              <th>cadence</th>
              <th>rate</th>
              <th>run span @{FLOW_COUNT}</th>
              <th>provenance</th>
              <th>description</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(TRAFFIC_PROFILES).map((profile) => {
              const maxInterval = profile.steps.length > 0 ? Math.max(...profile.steps.map((step) => step.intervalMs)) : 0;
              return (
                <tr key={profile.id}>
                  <td>
                    <div>{profile.name}</div>
                    <div className="meta">{profile.id}</div>
                  </td>
                  <td>
                    {profile.steps.map((step) => (
                      <div key={step.id} className="meta">
                        {step.label}: {step.protocol}/{step.dstPort} → {step.target}
                      </div>
                    ))}
                  </td>
                  <td>
                    {profile.steps.map((step) => (
                      <div key={step.id} className="meta">
                        {formatMs(step.intervalMs)} ±{formatMs(step.jitterMs)}
                      </div>
                    ))}
                  </td>
                  <td>
                    {profile.steps.map((step) => (
                      <div key={step.id} className="meta" title="derived from step interval — jitter excluded">
                        {formatRate(step.intervalMs)} <Chip tone="muted">estimate</Chip>
                      </div>
                    ))}
                  </td>
                  <td className="meta" title="max step interval × count — jitter excluded">
                    ~{formatMs(maxInterval * FLOW_COUNT)} <Chip tone="muted">estimate</Chip>
                  </td>
                  <td>
                    <Chip tone="muted">{profile.provenance}</Chip>
                  </td>
                  <td className="meta">{profile.description}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Pane>
    </div>
  );
}
