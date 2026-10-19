import { Fragment, useState } from "react";
import { useApp } from "../store";
import { Chip, Empty, KV, Pane, type Tone } from "../ui";
import { formatStockAclEntry, parseStockAclLine } from "../../engine/firewall";
import type {
  AclEntryModel,
  PortForwardModel,
  ProjectModel,
  RuleModel,
  StockAclModel,
  ZoneId
} from "../../engine/model";
import { FIRMWARE_PROFILES } from "../../registry/profiles";

const PROTOCOLS: RuleModel["protocol"][] = ["any", "TCP", "UDP", "ICMP", "ARP", "IPv6", "OTHER"];
const ZONES: (ZoneId | "any")[] = ["any", "internet", "upstream", "guest", "trusted", "mgmt"];

const ACL_LISTS: { key: keyof StockAclModel; label: string; evaluation: string; tone: Tone }[] = [
  { key: "guestToUplink", label: "guest → uplink", evaluation: "evaluated — outbound", tone: "accent" },
  { key: "uplinkToGuest", label: "uplink → guest", evaluation: "evaluated — inbound DNAT", tone: "accent" },
  { key: "guestToGuest", label: "guest → guest", evaluation: "not modeled — Wi-Fi driver relays it", tone: "muted" },
  { key: "uplinkLoop", label: "uplink → uplink", evaluation: "not consulted by this engine", tone: "muted" }
];

function formatPorts(range: [number, number] | null): string {
  if (!range) return "*";
  return range[0] === range[1] ? String(range[0]) : `${range[0]}-${range[1]}`;
}

function parsePorts(text: string): [number, number] | null | undefined {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "" || trimmed === "*" || trimmed === "any") return null;
  const match = trimmed.match(/^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/);
  if (!match) return undefined;
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  if (from > 65535 || to > 65535 || from > to) return undefined;
  return [from, to];
}

function pairedForward(project: ProjectModel, forward: PortForwardModel): PortForwardModel | null {
  const gateway = project.devices.find((device) => device.gateway);
  const router = project.devices.find((device) => device.isRouter);
  if (!gateway || !router) return null;
  if (forward.routerId === gateway.id) {
    return (
      project.portForwards.find(
        (candidate) =>
          candidate.routerId === router.id &&
          candidate.protocol === forward.protocol &&
          candidate.externalPort === forward.internalPort
      ) ?? null
    );
  }
  if (forward.routerId === router.id) {
    return (
      project.portForwards.find(
        (candidate) =>
          candidate.routerId === gateway.id &&
          candidate.protocol === forward.protocol &&
          candidate.internalPort === forward.externalPort
      ) ?? null
    );
  }
  return null;
}

function TextCell({
  value,
  commit,
  width,
  placeholder,
  title
}: {
  value: string;
  commit: (value: string) => void;
  width?: number;
  placeholder?: string;
  title?: string;
}) {
  return (
    <input
      className="input"
      style={{ width }}
      value={value}
      placeholder={placeholder}
      title={title}
      onChange={(event) => commit(event.target.value)}
    />
  );
}

function PortsCell({
  range,
  setRange
}: {
  range: [number, number] | null;
  setRange: (range: [number, number] | null) => void;
}) {
  const [text, setText] = useState(formatPorts(range));
  return (
    <input
      className="input"
      style={{ width: 76 }}
      value={text}
      placeholder="*"
      title="dst ports — * | 443 | 1000-2000"
      onChange={(event) => {
        setText(event.target.value);
        const parsed = parsePorts(event.target.value);
        if (parsed !== undefined) setRange(parsed);
      }}
      onBlur={() => setText(formatPorts(range))}
    />
  );
}

function RateCell({ value, setValue }: { value: number | null; setValue: (value: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  return (
    <input
      className="input"
      style={{ width: 54 }}
      value={text}
      placeholder="—"
      title="allow rate limit in packets/s — empty = no limit"
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (next.trim() === "") {
          setValue(null);
          return;
        }
        const parsed = Number(next);
        if (Number.isInteger(parsed) && parsed >= 0) setValue(parsed === 0 ? null : parsed);
      }}
      onBlur={() => setText(value === null ? "" : String(value))}
    />
  );
}

function AclListEditor({
  listKey,
  label,
  evaluation,
  tone
}: {
  listKey: keyof StockAclModel;
  label: string;
  evaluation: string;
  tone: Tone;
}) {
  const app = useApp();
  const [text, setText] = useState(() =>
    app.project.firewall.stockAcl[listKey].map(formatStockAclEntry).join("\n")
  );

  const edit = (next: string) => {
    setText(next);
    const previous = app.project.firewall.stockAcl[listKey];
    const entries: AclEntryModel[] = [];
    next.split("\n").forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) return;
      const parsed = parseStockAclLine(line, `${listKey}-${index}`);
      if (!parsed.ok || !parsed.entry) return;
      const prior = previous[index];
      const keepDrop = prior && prior.action === "drop" && formatStockAclEntry(prior) === trimmed;
      entries.push(keepDrop ? { ...parsed.entry, action: "drop" } : parsed.entry);
    });
    app.setProject((draft) => {
      draft.firewall.stockAcl[listKey] = entries;
    });
    app.setNotice("rerun the battery to see new verdicts");
  };

  const diagnostics = text
    .split("\n")
    .flatMap((line, index): { line: number; text: string; severity: "danger" | "warn" }[] => {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) return [];
      const parsed = parseStockAclLine(line, `${listKey}-line-${index}`);
      if (!parsed.ok) return [{ line: index + 1, text: parsed.error ?? "parse error", severity: "danger" }];
      if (parsed.warnings.length > 0) {
        return [{ line: index + 1, text: parsed.warnings.join("; "), severity: "warn" }];
      }
      return [];
    });

  return (
    <div className="card">
      <h4>
        {label} <Chip tone={tone}>{evaluation}</Chip>
      </h4>
      <p className="meta">
        model: {app.project.firewall.stockAcl[listKey].length} entr(y|ies) — one line per entry, first match wins,
        default allow when nothing matches
      </p>
      <textarea
        className="input"
        rows={4}
        style={{ width: "100%" }}
        spellCheck={false}
        value={text}
        placeholder="tcp/80-80/0.0.0.0/0"
        onChange={(event) => edit(event.target.value)}
      />
      {diagnostics.map((item) => (
        <div key={`${item.line}-${item.text}`} className={`meta tone-${item.severity}`}>
          line {item.line}: {item.text}
        </div>
      ))}
    </div>
  );
}

export default function RulesPage() {
  const app = useApp();
  const project = app.project;
  const dialect = project.firewall.dialect;
  const firmware = FIRMWARE_PROFILES[project.sim.firmwareId];
  const enabledCount = project.firewall.rules.filter((rule) => rule.enabled).length;
  const aclEntries = project.firewall.stockAcl
    ? project.firewall.stockAcl.uplinkToGuest.length +
      project.firewall.stockAcl.guestToUplink.length +
      project.firewall.stockAcl.guestToGuest.length +
      project.firewall.stockAcl.uplinkLoop.length
    : 0;
  const hitsTotal = project.firewall.rules.reduce((sum, rule) => sum + app.engine.ruleHitsFor(rule.id), 0);

  const hint = () => app.setNotice("rerun the battery to see new verdicts");

  const updateRule = (id: string, mutate: (rule: RuleModel) => void) => {
    app.setProject((draft) => {
      const rule = draft.firewall.rules.find((item) => item.id === id);
      if (rule) mutate(rule);
    });
    hint();
  };

  const addRule = () => {
    app.setProject((draft) => {
      const rules = draft.firewall.rules;
      let n = rules.length + 1;
      while (rules.some((rule) => rule.id === `rule-${n}`)) n += 1;
      rules.push({
        id: `rule-${n}`,
        name: "new rule",
        enabled: true,
        src: "any",
        dst: "any",
        srcZone: "any",
        dstZone: "any",
        protocol: "any",
        srcPorts: null,
        dstPorts: null,
        inInterface: "any",
        outInterface: "any",
        connStates: null,
        action: "drop",
        log: true,
        rateLimitPerSec: null,
        description: "drop any → any — narrow src/dst/ports and set action accept to open a path"
      });
    });
    hint();
  };

  const removeRule = (id: string) => {
    app.setProject((draft) => {
      const index = draft.firewall.rules.findIndex((rule) => rule.id === id);
      if (index >= 0) draft.firewall.rules.splice(index, 1);
    });
    hint();
  };

  const moveRule = (index: number, delta: number) => {
    app.setProject((draft) => {
      const rules = draft.firewall.rules;
      const target = index + delta;
      if (index < 0 || target < 0 || target >= rules.length) return;
      const [rule] = rules.splice(index, 1);
      rules.splice(target, 0, rule);
    });
    hint();
  };

  const toggleForward = (id: string) => {
    app.setProject((draft) => {
      const forward = draft.portForwards.find((item) => item.id === id);
      if (forward) forward.enabled = !forward.enabled;
    });
    hint();
  };

  return (
    <div className="page">
      <h2>Firewall — stateful rules and stock 4-list ACL</h2>

      <div className="grid2">
        <Pane title="[dialect]">
          <KV k="firmware" v={app.meta().firmwareName} />
          <KV
            k="dialect"
            v={
              <>
                <Chip tone={dialect === "stateful" ? "accent" : "warn"}>{dialect}</Chip>{" "}
                <span className="meta">read-only — declared by the firmware profile; change firmware in the top bar</span>
              </>
            }
          />
          <KV k="profile acl" v={<Chip tone="muted">{firmware.acl}</Chip>} />
          <KV
            k="hardware"
            v={
              firmware.implementedOnHardware ? (
                <Chip tone="ok">implemented on hardware</Chip>
              ) : (
                <Chip tone="warn">not implemented on hardware</Chip>
              )
            }
          />
          <KV
            k="default policy"
            v={
              <span className="row" style={{ gap: 6 }}>
                <select
                  value={project.firewall.defaultPolicy}
                  onChange={(event) => {
                    const value = event.target.value as "allow" | "deny";
                    app.setProject((draft) => {
                      draft.firewall.defaultPolicy = value;
                    });
                    hint();
                  }}
                >
                  <option value="allow">allow</option>
                  <option value="deny">deny</option>
                </select>
                {dialect !== "stateful" ? <Chip tone="warn">not consulted by dialect {dialect}</Chip> : null}
              </span>
            }
          />
          <p className="meta">
            stateful dialect evaluates rules first-match; when none matches the default policy applies.{" "}
            <Chip tone="muted">datasheet</Chip>
          </p>
        </Pane>
        <Pane title="[engine status]">
          <KV k="stateful rules" v={`${project.firewall.rules.length} (${enabledCount} enabled)`} />
          <KV
            k="port forwards"
            v={`${project.portForwards.filter((forward) => forward.enabled).length} / ${project.portForwards.length} enabled`}
          />
          <KV k="stock acl" v={`${aclEntries} entries across 4 lists`} />
          <KV k="rule hits" v={`${hitsTotal} total`} />
          <KV k="battery results" v={`${app.results.length} flow(s) evaluated`} />
          <p className="meta">
            hit counts come from matched engine traces; the engine rebuilds on every project edit, so hits reset.{" "}
            <Chip tone="muted">measured</Chip>
          </p>
        </Pane>
      </div>

      {dialect !== "stateful" ? (
        <div className="card">
          {dialect === "stock-4list" ? (
            <>
              <h4>
                stock-4list semantics <Chip tone="warn">stateless</Chip> <Chip tone="warn">default-ALLOW</Chip>{" "}
                <Chip tone="warn">non-IPv4 unfiltered</Chip> <Chip tone="danger">no source-device match</Chip>
              </h4>
              <div className="reason">
                Stock firmware evaluates four stateless IPv4 lists, first match wins per list, and allows when nothing
                matches — no default-deny, no connection tracking. ARP/IPv6/other frames are relayed below lwIP and are
                never filtered. Lists match destination address and port only, so an individual guest host cannot be
                blocked — remove or disable the client instead. The stateful rule list below is inert under this dialect.
              </div>
            </>
          ) : (
            <>
              <h4>
                dialect none — no filtering at all <Chip tone="warn">softap_sta baseline</Chip>{" "}
                <Chip tone="danger">stateful list inert</Chip>
              </h4>
              <div className="reason">
                The official ESP-IDF softap_sta + NAPT example forwards and translates with no ACL, no default policy and
                no management surface. The stateful list and the stock 4-list below are both stored but never consulted.
              </div>
            </>
          )}
          <div className="labels">
            <Chip tone="muted">measured</Chip>
            <Chip tone="muted">datasheet</Chip>
          </div>
        </div>
      ) : null}

      <Pane
        title={`[stateful rules] ${dialect === "stateful" ? "active" : "inert"}`}
        right={<button onClick={addRule}>add rule</button>}
      >
        {dialect !== "stateful" ? (
          <p className="meta tone-warn">
            inert under dialect {dialect} — entries are preserved and become evaluable only under the target-v1 stateful
            design (not implemented on hardware).
          </p>
        ) : null}
        {project.firewall.rules.length === 0 ? (
          <Empty text="no stateful rules — add one to exercise first-match evaluation under the stateful dialect" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>on</th>
                <th>name</th>
                <th>action</th>
                <th>proto</th>
                <th>src</th>
                <th>dst</th>
                <th>dst ports</th>
                <th>limit/s</th>
                <th>hits</th>
                <th>order</th>
              </tr>
            </thead>
            <tbody>
              {project.firewall.rules.map((rule, index) => (
                <Fragment key={rule.id}>
                  <tr>
                    <td className="meta">{index + 1}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        title={rule.enabled ? "enabled" : "disabled"}
                        onChange={(event) => updateRule(rule.id, (item) => (item.enabled = event.target.checked))}
                      />
                    </td>
                    <td>
                      <TextCell
                        value={rule.name}
                        width={130}
                        commit={(value) => updateRule(rule.id, (item) => (item.name = value))}
                      />
                    </td>
                    <td>
                      <select
                        value={rule.action}
                        title="accept allows; drop/reject deny"
                        onChange={(event) =>
                          updateRule(rule.id, (item) => (item.action = event.target.value as RuleModel["action"]))
                        }
                      >
                        <option value="accept">accept</option>
                        <option value="drop">drop</option>
                        <option value="reject">reject</option>
                      </select>
                    </td>
                    <td>
                      <select
                        value={rule.protocol}
                        onChange={(event) =>
                          updateRule(rule.id, (item) => (item.protocol = event.target.value as RuleModel["protocol"]))
                        }
                      >
                        {PROTOCOLS.map((protocol) => (
                          <option key={protocol} value={protocol}>
                            {protocol}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <TextCell
                        value={rule.src}
                        width={82}
                        placeholder="any"
                        title="any | device id | IPv4 | CIDR"
                        commit={(value) => updateRule(rule.id, (item) => (item.src = value))}
                      />
                    </td>
                    <td>
                      <TextCell
                        value={rule.dst}
                        width={82}
                        placeholder="any"
                        title="any | device id | IPv4 | CIDR"
                        commit={(value) => updateRule(rule.id, (item) => (item.dst = value))}
                      />
                    </td>
                    <td>
                      <PortsCell range={rule.dstPorts} setRange={(range) => updateRule(rule.id, (item) => (item.dstPorts = range))} />
                    </td>
                    <td>
                      <RateCell
                        value={rule.rateLimitPerSec}
                        setValue={(value) => updateRule(rule.id, (item) => (item.rateLimitPerSec = value))}
                      />
                    </td>
                    <td className="meta">{app.engine.ruleHitsFor(rule.id)}</td>
                    <td>
                      <button
                        disabled={index === 0}
                        title="move up (first match wins)"
                        onClick={() => moveRule(index, -1)}
                      >
                        ↑
                      </button>{" "}
                      <button
                        disabled={index === project.firewall.rules.length - 1}
                        title="move down"
                        onClick={() => moveRule(index, 1)}
                      >
                        ↓
                      </button>{" "}
                      <button title="delete rule" onClick={() => removeRule(rule.id)}>
                        del
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={11}>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="meta">src zone</span>
                        <select
                          value={rule.srcZone}
                          onChange={(event) =>
                            updateRule(rule.id, (item) => (item.srcZone = event.target.value as ZoneId | "any"))
                          }
                        >
                          {ZONES.map((zone) => (
                            <option key={zone} value={zone}>
                              {zone}
                            </option>
                          ))}
                        </select>
                        <span className="meta">dst zone</span>
                        <select
                          value={rule.dstZone}
                          onChange={(event) =>
                            updateRule(rule.id, (item) => (item.dstZone = event.target.value as ZoneId | "any"))
                          }
                        >
                          {ZONES.map((zone) => (
                            <option key={zone} value={zone}>
                              {zone}
                            </option>
                          ))}
                        </select>
                        <span className="meta">in</span>
                        <TextCell
                          value={rule.inInterface}
                          width={64}
                          placeholder="any"
                          title="any | wan0 | guest0"
                          commit={(value) => updateRule(rule.id, (item) => (item.inInterface = value))}
                        />
                        <span className="meta">out</span>
                        <TextCell
                          value={rule.outInterface}
                          width={64}
                          placeholder="any"
                          title="any | wan0 | guest0"
                          commit={(value) => updateRule(rule.id, (item) => (item.outInterface = value))}
                        />
                        <span className="meta">conn state</span>
                        <Chip tone="muted">{rule.connStates === null ? "any" : rule.connStates.join("/")}</Chip>
                        <TextCell
                          value={rule.description}
                          width={300}
                          placeholder="description"
                          commit={(value) => updateRule(rule.id, (item) => (item.description = value))}
                        />
                        <span className="meta">log flag is stored but not simulated</span>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        <p className="meta">
          src/dst accept any | device id | IPv4 | CIDR; ports accept * | 443 | 1000-2000. fields commit through
          setProject — every edit rebuilds the engine. <Chip tone="muted">measured</Chip>
        </p>
      </Pane>

      {dialect !== "stateful" && project.firewall.stockAcl ? (
        <Pane title="[stock acl — 4 lists]">
          <p className="meta">
            stock syntax: proto/portFrom-portTo/ip|subnet — first match wins per list. The stock text format carries no
            action token, so parsed lines are allow entries; an existing drop entry survives only while its line is left
            unchanged. Blank lines and # comments are skipped. <Chip tone="muted">datasheet</Chip>
          </p>
          <div className="grid2">
            {ACL_LISTS.map((list) => (
              <AclListEditor
                key={list.key}
                listKey={list.key}
                label={list.label}
                evaluation={dialect === "none" ? "not evaluated under dialect none" : list.evaluation}
                tone={dialect === "none" ? "muted" : list.tone}
              />
            ))}
          </div>
        </Pane>
      ) : null}

      <Pane
        title={`[port forwards] ${project.portForwards.filter((forward) => forward.enabled).length} / ${project.portForwards.length} enabled`}
      >
        <p className="meta">
          inbound reachability needs both double-NAT legs enabled — the gateway forward first, then the ESP32 DNAT.
          Exposure labels are derived from engine DNAT semantics. <Chip tone="muted">measured</Chip>
        </p>
        {project.portForwards.length === 0 ? (
          <Empty text="no port forwards configured — inbound flows are dropped at the NAT boundary" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>id</th>
                <th>router</th>
                <th>proto</th>
                <th>ext port</th>
                <th>internal target</th>
                <th>int port</th>
                <th>enabled</th>
                <th>exposure</th>
                <th>note</th>
              </tr>
            </thead>
            <tbody>
              {project.portForwards.map((forward) => {
                const router = project.devices.find((device) => device.id === forward.routerId);
                const target = project.devices.find((device) => device.id === forward.internalDeviceId);
                const pair = pairedForward(project, forward);
                const active = forward.enabled && pair?.enabled === true;
                return (
                  <tr key={forward.id}>
                    <td className="meta">{forward.id}</td>
                    <td>{router?.name ?? forward.routerId}</td>
                    <td className="meta">{forward.protocol}</td>
                    <td className="meta">{forward.externalPort}</td>
                    <td>
                      {target?.name ?? forward.internalDeviceId} <span className="meta">{target?.ipv4 ?? "—"}</span>
                    </td>
                    <td className="meta">{forward.internalPort}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={forward.enabled}
                        title={forward.enabled ? "disable forward" : "enable forward"}
                        onChange={() => toggleForward(forward.id)}
                      />
                    </td>
                    <td>
                      {!forward.enabled ? (
                        <Chip tone="muted">disabled — not in the DNAT path</Chip>
                      ) : active ? (
                        <Chip tone="danger">enabled — full path active (inbound exposure)</Chip>
                      ) : (
                        <Chip tone="warn">
                          enabled — {pair ? "other leg disabled" : "no matching forward on the other router"}, path
                          incomplete
                        </Chip>
                      )}
                    </td>
                    <td className="meta">
                      {forward.note} <Chip tone="muted">assumption</Chip>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Pane>
    </div>
  );
}
