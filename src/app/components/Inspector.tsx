import { isDocumentationIPv4, isPrivateIPv4 } from "../../engine/address";
import type { DeviceModel } from "../../engine/model";

const EGRESS_LABELS: Record<string, string> = {
  "vendor-only": "vendor-cloud only",
  "allow-all": "allow all egress",
  "block-all": "block all egress"
};

const ROLE_LABELS: Record<string, string> = {
  iot: "IoT device",
  infrastructure: "infrastructure",
  external: "external host",
  attacker: "attacker"
};

function addressNote(ip: string): string {
  if (isDocumentationIPv4(ip)) return "RFC 5737 documentation range (simulation-assigned)";
  if (isPrivateIPv4(ip)) return "private range (simulation-assigned)";
  return "public address";
}

export function Inspector({ device }: { device: DeviceModel | null }) {
  if (!device) {
    return <p className="meta">Select a node in the topology to inspect it.</p>;
  }
  return (
    <div>
      <dl className="kv">
        <dt>name</dt>
        <dd>{device.name}</dd>
        <dt>role</dt>
        <dd>{ROLE_LABELS[device.role] ?? device.role}</dd>
        <dt>zone</dt>
        <dd>{device.zone}</dd>
        <dt>state</dt>
        <dd>
          {device.online ? "online" : "offline"}
          {device.compromised ? " · compromised" : ""}
          {device.quarantined ? " · quarantined" : ""}
          {device.isRouter ? " · router under study" : ""}
        </dd>
        <dt>ip</dt>
        <dd>
          {device.ipv4 ?? "—"}{" "}
          <span className="meta">· {device.ipv4 ? addressNote(device.ipv4) : "no address"}</span>
        </dd>
        {device.extraIps.length > 0 ? (
          <>
            <dt>wan ip</dt>
            <dd>{device.extraIps.join(", ")}</dd>
          </>
        ) : null}
        <dt>mac</dt>
        <dd>{device.mac}</dd>
        {device.role === "iot" ? (
          <>
            <dt>egress</dt>
            <dd>{EGRESS_LABELS[device.egressPolicyId]}</dd>
          </>
        ) : null}
      </dl>
      {device.services.length > 0 ? (
        <div className="vendors">
          <h5>services</h5>
          {device.services.map((service) => (
            <div key={`${service.name}-${service.port}`} className="meta">
              {service.name} · {service.protocol.toLowerCase()}/{service.port}
            </div>
          ))}
        </div>
      ) : null}
      {device.vendorEndpoints.length > 0 ? (
        <div className="vendors">
          <h5>vendor endpoints</h5>
          {device.vendorEndpoints.map((endpoint) => (
            <div key={`${endpoint.ip}-${endpoint.protocol}`} className="meta">
              {endpoint.protocol.toLowerCase()} {endpoint.ip} ports {endpoint.ports.join(", ")} ({endpoint.provenance})
            </div>
          ))}
        </div>
      ) : null}
      {device.notes ? <p className="meta">{device.notes}</p> : null}
    </div>
  );
}
