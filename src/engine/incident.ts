export type IncidentSeverity = "low" | "medium" | "high";
export type IncidentStatus = "open" | "contained" | "closed";
export type IncidentActionKind = "quarantine" | "block-rule" | "note" | "close";

export interface IncidentAction {
  atMs: number;
  kind: IncidentActionKind;
  detail: string;
}

export interface IncidentModel {
  id: string;
  title: string;
  deviceId: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  openedMs: number;
  closedMs: number | null;
  evidence: number[];
  actions: IncidentAction[];
}

export class IncidentLog {
  private nextId = 1;
  private items: IncidentModel[] = [];

  get all(): readonly IncidentModel[] {
    return this.items;
  }

  get openCount(): number {
    return this.items.filter((incident) => incident.status !== "closed").length;
  }

  open(params: {
    title: string;
    deviceId?: string | null;
    severity: IncidentSeverity;
    evidence?: number[];
    atMs: number;
  }): IncidentModel {
    const incident: IncidentModel = {
      id: `INC-${String(this.nextId).padStart(3, "0")}`,
      title: params.title,
      deviceId: params.deviceId ?? null,
      severity: params.severity,
      status: "open",
      openedMs: params.atMs,
      closedMs: null,
      evidence: [...(params.evidence ?? [])],
      actions: []
    };
    this.nextId += 1;
    this.items.push(incident);
    return incident;
  }

  addEvidence(id: string, eventIds: number[]): IncidentModel | null {
    const incident = this.find(id);
    if (!incident || incident.status === "closed") return null;
    incident.evidence.push(...eventIds);
    return incident;
  }

  contain(id: string, atMs: number, detail: string): IncidentModel | null {
    const incident = this.find(id);
    if (!incident || incident.status === "closed") return null;
    incident.status = "contained";
    incident.actions.push({ atMs, kind: "quarantine", detail });
    return incident;
  }

  addAction(id: string, atMs: number, kind: IncidentActionKind, detail: string): IncidentModel | null {
    const incident = this.find(id);
    if (!incident || incident.status === "closed") return null;
    if (kind === "close") {
      incident.status = "closed";
      incident.closedMs = atMs;
    }
    incident.actions.push({ atMs, kind, detail });
    return incident;
  }

  close(id: string, atMs: number, detail: string): IncidentModel | null {
    return this.addAction(id, atMs, "close", detail);
  }

  clear(): void {
    this.items = [];
    this.nextId = 1;
  }

  private find(id: string): IncidentModel | null {
    return this.items.find((incident) => incident.id === id) ?? null;
  }
}
