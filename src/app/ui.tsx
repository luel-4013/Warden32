import type { ReactNode } from "react";
import type { FlowResult } from "../engine/types";

export type Tone = "ok" | "warn" | "danger" | "accent" | "muted" | "";

export function Pane({
  title,
  right,
  children,
  className
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`pane ${className ?? ""}`}>
      <div className="pane-title">
        <span>{title}</span>
        {right ? <span className="pane-actions">{right}</span> : null}
      </div>
      <div className="pane-scroll scroll">{children}</div>
    </section>
  );
}

export function Chip({ tone, children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`chip ${tone ?? ""}`} title={title}>
      {children}
    </span>
  );
}

export function KV({ k, v, tone }: { k: string; v: ReactNode; tone?: Tone }) {
  return (
    <dl className="kv">
      <dt>{k}</dt>
      <dd className={tone ?? ""}>{v}</dd>
    </dl>
  );
}

export function KVGroup({ children }: { children: ReactNode }) {
  return <div className="kv-group">{children}</div>;
}

export function Empty({ text }: { text: string }) {
  return <p className="meta">{text}</p>;
}

export const VERDICT_TONE: Record<FlowResult["verdict"], Tone> = {
  allowed: "ok",
  denied: "danger",
  dropped: "danger",
  "not-enforceable": "warn"
};

export const CATEGORY_TONE: Record<string, Tone> = {
  system: "muted",
  pipeline: "",
  firewall: "warn",
  nat: "",
  conntrack: "muted",
  routing: "",
  resource: "warn",
  traffic: "",
  attack: "danger",
  wifi: "warn",
  incident: "danger",
  metrics: "accent"
};

export function toneForLabel(label: string): Tone {
  if (label.includes("not implemented on hardware")) return "warn";
  if (label.includes("isolation")) return "warn";
  if (label.includes("no egress filtering")) return "warn";
  if (label.includes("management surface reachable")) return "danger";
  if (label.includes("no route")) return "warn";
  if (label.includes("quarantine")) return "danger";
  if (label.includes("RAM") || label.includes("NAPT") || label.includes("tx queue")) return "danger";
  if (label.includes("spoofed")) return "danger";
  if (label.includes("double NAT")) return "muted";
  if (label.includes("non-IPv4")) return "warn";
  if (label.includes("port-forward")) return "warn";
  return "";
}
