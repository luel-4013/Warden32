import { useState } from "react";
import { useApp } from "../store";
import { Chip, Empty, Pane, toneForLabel, type Tone } from "../ui";
import { DEVICE_ARCHETYPES } from "../../registry/devices";
import { TRAFFIC_PROFILES } from "../../engine/traffic";
import type { Provenance } from "../../engine/types";

function provenanceTone(provenance: Provenance): Tone {
  if (provenance === "measured") return "ok";
  if (provenance === "datasheet") return "accent";
  if (provenance === "assumption") return "warn";
  return "muted";
}

const demoEndpoints = DEVICE_ARCHETYPES.flatMap((archetype) => archetype.vendorEndpoints).filter(
  (endpoint, index, all) =>
    all.findIndex((candidate) => candidate.ip === endpoint.ip && candidate.protocol === endpoint.protocol) === index
);

export default function RegistryPage() {
  const { setPage } = useApp();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const archetypes = DEVICE_ARCHETYPES.filter((archetype) => {
    if (needle === "") return true;
    const haystack = [
      archetype.id,
      archetype.name,
      archetype.category,
      archetype.behaviorState,
      archetype.notes,
      archetype.trafficProfileId,
      ...archetype.services.map((service) => `${service.name} ${service.protocol} ${service.port}`),
      ...archetype.vendorEndpoints.map((endpoint) => endpoint.ip)
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });

  return (
    <div className="page">
      <h2>registry · config</h2>
      <Pane
        title="1 · device archetypes"
        right={
          <Chip tone="muted">
            {archetypes.length} / {DEVICE_ARCHETYPES.length} shown
          </Chip>
        }
      >
        <div className="row">
          <input
            className="input"
            placeholder="filter by name / id / category / notes"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ minWidth: 280 }}
          />
          {query !== "" ? <button onClick={() => setQuery("")}>clear</button> : null}
          <button onClick={() => setPage("docs")}>provenance legend</button>
        </div>
        <p className="meta">
          The engine consumes device models built from these archetypes. This registry has no vendor field — the filter covers id, name,
          category, notes, services and endpoint IPs instead.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>archetype</th>
              <th>category</th>
              <th>services</th>
              <th>management</th>
              <th>egress policy</th>
              <th>traffic profile</th>
              <th>vendor endpoints</th>
              <th>provenance</th>
            </tr>
          </thead>
          <tbody>
            {archetypes.map((archetype) => (
              <tr key={archetype.id}>
                <td>
                  <strong>{archetype.name}</strong>
                  {archetype.provenance === "assumption" ? (
                    <Chip
                      tone={toneForLabel("not implemented on hardware")}
                      title="hypothetical archetype — demo scaffolding with no measured hardware behavior"
                    >
                      not implemented on hardware
                    </Chip>
                  ) : null}
                  <div className="meta">
                    {archetype.id} · {archetype.notes}
                  </div>
                </td>
                <td>
                  {archetype.category}
                  <div className="meta">{archetype.behaviorState}</div>
                </td>
                <td>
                  {archetype.services.length > 0
                    ? archetype.services.map((service) => `${service.name} ${service.protocol}/${service.port}`).join(", ")
                    : "none"}
                </td>
                <td>{archetype.managementPorts.length > 0 ? archetype.managementPorts.join(", ") : "none"}</td>
                <td>{archetype.egressPolicyId}</td>
                <td>{archetype.trafficProfileId}</td>
                <td>
                  {archetype.vendorEndpoints.length > 0
                    ? archetype.vendorEndpoints
                        .map((endpoint) => `${endpoint.ip} ${endpoint.protocol}/${endpoint.ports.join("+")}`)
                        .join(", ")
                    : "none"}
                </td>
                <td>
                  <Chip tone={provenanceTone(archetype.provenance)}>{archetype.provenance}</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {archetypes.length === 0 ? <Empty text={`no archetype matches "${query.trim()}"`} /> : null}
      </Pane>

      <Pane
        title="2 · traffic profiles"
        right={<Chip tone="muted">{Object.keys(TRAFFIC_PROFILES).length} profiles</Chip>}
      >
        <p className="meta">
          Step intervals are the modeled cadence with deterministic jitter; run duration and flow counts are chosen per experiment, not fixed
          in the profile. All timing is simulated, never wall-clock.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>profile</th>
              <th>steps (target · protocol · port · interval)</th>
              <th>description</th>
              <th>provenance</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(TRAFFIC_PROFILES).map((profile) => (
              <tr key={profile.id}>
                <td>
                  <strong>{profile.name}</strong>
                  <div className="meta">{profile.id}</div>
                </td>
                <td>
                  {profile.steps.map((step) => (
                    <div key={step.id}>
                      {step.target} · {step.protocol}:{step.dstPort} · every {step.intervalMs} ms ± {step.jitterMs} ms
                    </div>
                  ))}
                </td>
                <td>{profile.description}</td>
                <td>
                  <Chip tone={provenanceTone(profile.provenance)}>{profile.provenance}</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Pane>

      <Pane
        title="3 · demo cloud endpoint"
        right={<Chip tone={provenanceTone("assumption")}>assumption</Chip>}
      >
        <p className="meta">
          Fictional deterministic experiment endpoint — RFC 5737 documentation addresses (203.0.113.0/24), not a live service. The lab never
          contacts it and nothing leaves the browser. Archetypes with the vendor-only egress policy point at this shared endpoint set.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>address</th>
              <th>protocol</th>
              <th>ports</th>
              <th>provenance</th>
            </tr>
          </thead>
          <tbody>
            {demoEndpoints.map((endpoint) => (
              <tr key={`${endpoint.ip}:${endpoint.protocol}`}>
                <td>{endpoint.ip}</td>
                <td>{endpoint.protocol}</td>
                <td>{endpoint.ports.join(", ")}</td>
                <td>
                  <Chip tone={provenanceTone(endpoint.provenance)}>{endpoint.provenance}</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {demoEndpoints.length === 0 ? <Empty text="no shared demo endpoints in the registry" /> : null}
        <p className="meta">
          Address provenance is assumption: no vendor IP was measured or looked up for this lab. Anything tagged measured elsewhere in the
          app comes from a primary source or real hardware, never from this endpoint.
        </p>
      </Pane>
    </div>
  );
}
