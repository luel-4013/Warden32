import { useApp } from "../store";
import { Chip, Pane } from "../ui";

const FACTS: { text: string; tag: string }[] = [
  { text: "ESP32 SoftAP has no client isolation — the closed Wi-Fi library relays guest-to-guest frames (esp-idf #13781, not planned).", tag: "measured" },
  { text: "Stock ACLs are stateless 4-list IPv4 filters, default-ALLOW, non-IPv4 unfiltered, ~8 clients, 5–15 Mbps routed.", tag: "estimate" },
  { text: "S2/S3/C3/C5/C6 have no internal EMAC — only ESP32/P4/S31 do RMII.", tag: "datasheet" },
  { text: "The LabEngine never invents enforcement: unenforceable frames are reported as \"not enforceable\", never \"blocked\".", tag: "policy" },
  { text: "Everything runs locally and deterministically; the same seed and flows always produce identical results.", tag: "measured" }
];

export default function OverviewPage() {
  const app = useApp();
  const verdicts = { allowed: 0, denied: 0, dropped: 0, "not-enforceable": 0 } as Record<string, number>;
  for (const result of app.results) verdicts[result.verdict] += 1;

  return (
    <div className="page">
      <h2>WARDEN32 — honest ESP32 firewall lab</h2>
      <p className="meta">
        Deterministic, offline simulation of an ESP32-WROOM-32D + LAN8720 IoT router: double NAT, guest SoftAP, stock
        vs target firewall dialects, attack lab and incident response. Every number carries provenance; nothing is
        faked to look enforceable.
      </p>

      <div className="grid3 grow">
        <Pane title="[project]">
          <p className="meta">{app.project.meta.name}</p>
          <p className="meta">zones: {app.project.zones.length} · devices: {app.project.devices.length}</p>
          <p className="meta">seed: {app.project.sim.seed} · public IP: {app.project.sim.publicIp}</p>
          <p className="meta">firmware: {app.meta().firmwareName}</p>
        </Pane>
        <Pane title="[pipeline]">
          <p className="meta">dialect: {app.project.firewall.dialect} ({app.project.firewall.defaultPolicy})</p>
          <p className="meta">rules: {app.project.firewall.rules.length} · forwards: {app.project.portForwards.length}</p>
          <p className="meta">conntrack: {app.engine.connections.size} / {app.engine.connections.capacity}</p>
          <p className="meta">events: {app.engine.events.count}</p>
        </Pane>
        <Pane title="[last battery]">
          {app.results.length === 0 ? (
            <p className="meta">no flows evaluated yet — run the sample battery from the top bar.</p>
          ) : (
            <>
              <p className="meta tone-ok">allowed: {verdicts.allowed}</p>
              <p className="meta tone-danger">denied: {verdicts.denied} · dropped: {verdicts.dropped}</p>
              <p className="meta tone-warn">not enforceable: {verdicts["not-enforceable"]}</p>
            </>
          )}
        </Pane>
      </div>

      <Pane title="[honesty] verified facts this lab is built on">
        <div className="labels">
          {FACTS.map((fact) => (
            <div key={fact.text} className="card">
              <div className="reason">{fact.text}</div>
              <div className="labels">
                <Chip tone="accent">{fact.tag}</Chip>
              </div>
            </div>
          ))}
        </div>
      </Pane>

      <Pane title="[quick actions]">
        <div className="row">
          <button className="primary" onClick={() => app.runSample()}>
            run sample battery
          </button>
          <button onClick={() => app.setPage("topology")}>open topology</button>
          <button onClick={() => app.setPage("attacks")}>attack catalog</button>
          <button onClick={() => app.setPage("experiments")}>experiments</button>
          <button onClick={() => app.setPage("docs")}>read the docs</button>
        </div>
      </Pane>
    </div>
  );
}
