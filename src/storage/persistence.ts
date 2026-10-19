const AUTOSAVE_KEY = "warden32.autosave.v1";
const PREFS_KEY = "warden32.prefs.v1";

export interface Prefs {
  recentProjectName?: string;
  railOpen?: boolean;
}

export function saveAutosave(text: string): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, text);
  } catch {
    /* storage unavailable */
  }
}

export function loadAutosave(): string | null {
  try {
    return localStorage.getItem(AUTOSAVE_KEY);
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Prefs) : {};
  } catch {
    return {};
  }
}

export interface TopoPoint {
  x: number;
  y: number;
}

export type TopoLayout = Record<string, TopoPoint>;

const TOPO_KEY = (projectId: string) => `warden32.topo.layout.v1.${projectId}`;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function loadTopoLayout(projectId: string): TopoLayout {
  try {
    const raw = localStorage.getItem(TOPO_KEY(projectId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const clean: TopoLayout = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value && typeof value === "object" && isFiniteNumber((value as TopoPoint).x) && isFiniteNumber((value as TopoPoint).y)) {
        clean[key] = { x: (value as TopoPoint).x, y: (value as TopoPoint).y };
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export function saveTopoLayout(projectId: string, layout: TopoLayout): void {
  try {
    localStorage.setItem(TOPO_KEY(projectId), JSON.stringify(layout));
  } catch {
    /* storage unavailable */
  }
}

export function clearTopoLayout(projectId: string): void {
  try {
    localStorage.removeItem(TOPO_KEY(projectId));
  } catch {
    /* storage unavailable */
  }
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "warden32-project" : slug;
}

export function downloadText(filename: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function readTextFile(file: File): Promise<string> {
  return await file.text();
}
