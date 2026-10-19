import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { DeviceModel } from "../../engine/model";
import { ETHERNET_ADAPTERS, HARDWARE_PROFILES } from "../../registry/profiles";
import {
  clearTopoLayout,
  loadTopoLayout,
  saveTopoLayout,
  type TopoLayout,
  type TopoPoint,
} from "../../storage/persistence";
import { useApp } from "../store";

const VIEW_W = 1020;
const VIEW_H = 560;

const WAN_SIZE = { w: 132, h: 44 };
const HOME_SIZE = { w: 132, h: 52 };
const MODULE_SIZE = { w: 100, h: 84 };
const ESP32_SIZE = { w: 168, h: 112 };
const GUEST_SIZE = { w: 150, h: 48 };

const MODULE_KEY = "module";
const ESP32_FALLBACK_KEY = "__esp32";

function shortName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, "");
}

function upper(name: string): string {
  return name.toUpperCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function guestY(index: number, count: number): number {
  if (count <= 1) return 276;
  return 96 + index * ((VIEW_H - 96 - 96) / Math.max(count - 1, 1));
}

function buildDefaults(wanIds: string[], homeId: string | null, espKey: string, guestIds: string[]): TopoLayout {
  const layout: TopoLayout = {};
  wanIds.forEach((id, index) => {
    layout[id] = { x: 16, y: 40 + index * 48 };
  });
  if (homeId) layout[homeId] = { x: 196, y: 266 };
  layout[MODULE_KEY] = { x: 398, y: 252 };
  layout[espKey] = { x: 534, y: 238 };
  guestIds.forEach((id, index) => {
    layout[id] = { x: 800, y: guestY(index, guestIds.length) };
  });
  return layout;
}

interface DragState {
  key: string;
  size: { w: number; h: number };
  dx: number;
  dy: number;
  moved: boolean;
}

export function TopologyCanvas() {
  const { project, results, selectedId, setSelectedId, setRightTab, setProject, setNotice } = useApp();
  const [zoom, setZoom] = useState(1);
  const [positions, setPositions] = useState<TopoLayout>({});
  const [dragging, setDragging] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const positionsRef = useRef<TopoLayout>(positions);

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    setPositions(loadTopoLayout(project.meta.id));
  }, [project.meta.id]);

  const adapter = ETHERNET_ADAPTERS.find((item) => item.id === project.sim.adapterId) ?? ETHERNET_ADAPTERS[0];
  const board = HARDWARE_PROFILES.find((item) => item.id === project.sim.boardId) ?? HARDWARE_PROFILES[0];
  const router = project.devices.find((device) => device.isRouter) ?? null;
  const home = project.devices.find((device) => device.gateway) ?? null;
  const wanDevices = project.devices.filter((device) => device.zone === "internet");
  const guests = project.devices.filter((device) => device.zone === "guest" && !device.isRouter);
  const guestZone = project.zones.find((zone) => zone.id === "guest");
  const guestPrefix = guestZone?.cidr?.split("/")[1] ?? "24";
  const esp32Key = router?.id ?? ESP32_FALLBACK_KEY;

  const defaults = useMemo(
    () =>
      buildDefaults(
        wanDevices.map((device) => device.id),
        home?.id ?? null,
        esp32Key,
        guests.map((device) => device.id),
      ),
    [wanDevices, home, esp32Key, guests],
  );

  const pos = (key: string): TopoPoint => positions[key] ?? defaults[key] ?? { x: 0, y: 0 };

  const verdictFor = useMemo(() => {
    const map = new Map<string, "allowed" | "denied" | "dropped" | "not-enforceable">();
    for (const result of results) {
      map.set(result.flow.srcDeviceId, result.verdict);
      map.set(result.flow.dstDeviceId, result.verdict);
    }
    return map;
  }, [results]);

  const select = (device: DeviceModel | null) => {
    if (!device) return;
    setSelectedId(device.id);
    setRightTab("inspect");
  };

  const toSvgPoint = (clientX: number, clientY: number): TopoPoint => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };

  const startDrag = (key: string, size: { w: number; h: number }, device: DeviceModel | null, event: ReactPointerEvent<SVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (device) select(device);
    const anchor = toSvgPoint(event.clientX, event.clientY);
    const start = pos(key);
    dragRef.current = { key, size, dx: anchor.x - start.x, dy: anchor.y - start.y, moved: false };
    svgRef.current?.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const anchor = toSvgPoint(event.clientX, event.clientY);
    const x = clamp(anchor.x - drag.dx, 0, VIEW_W - drag.size.w);
    const y = clamp(anchor.y - drag.dy, 0, VIEW_H - drag.size.h);
    drag.moved = true;
    setPositions((prev) => ({ ...prev, [drag.key]: { x, y } }));
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    if (drag.moved) saveTopoLayout(project.meta.id, positionsRef.current);
  };

  const resetLayout = () => {
    clearTopoLayout(project.meta.id);
    setPositions({});
    setNotice("topology layout reset");
  };

  const switchAdapter = (id: string) => {
    const next = ETHERNET_ADAPTERS.find((item) => item.id === id);
    setProject((draft) => {
      draft.sim.adapterId = id;
    });
    if (next && next.requiresInternalEmac && !board.internalEmac) {
      setNotice(`uplink module → ${shortName(next.name)} · warning: ${board.name} has no internal EMAC (RMII needs ESP32/P4/S31)`);
    } else if (next) {
      setNotice(`uplink module → ${shortName(next.name)} · engine rebuilt`);
    }
  };

  const switchBoard = (id: string) => {
    const next = HARDWARE_PROFILES.find((item) => item.id === id);
    setProject((draft) => {
      draft.sim.boardId = id;
    });
    if (next) setNotice(`board → ${next.name} · ${next.cores} @ ${next.clockMhz} MHz · engine rebuilt`);
  };

  const modulePos = pos(MODULE_KEY);
  const espPos = pos(esp32Key);
  const homePos = home ? pos(home.id) : null;

  const boardFrame = {
    x: Math.min(modulePos.x, espPos.x) - 14,
    y: Math.min(modulePos.y, espPos.y) - 16,
    w: Math.max(modulePos.x + MODULE_SIZE.w, espPos.x + ESP32_SIZE.w) + 14 - (Math.min(modulePos.x, espPos.x) - 14),
    h: Math.max(modulePos.y + MODULE_SIZE.h, espPos.y + ESP32_SIZE.h) + 16 - (Math.min(modulePos.y, espPos.y) - 16),
  };

  const moduleCenter = { x: modulePos.x + MODULE_SIZE.w / 2, y: modulePos.y + MODULE_SIZE.h / 2 };
  const espCenter = { x: espPos.x + ESP32_SIZE.w / 2, y: espPos.y + ESP32_SIZE.h / 2 };

  return (
    <div className="canvas-wrap">
      <div className="canvas-zoom scroll">
        <svg
          ref={svgRef}
          className={`topo ${dragging ? "dragging" : ""}`}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: `${zoom * 100}%` }}
          xmlns="http://www.w3.org/2000/svg"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <g className="pins">
            {[22, 42, 62].map((offset) => (
              <line key={`mpin-${offset}`} x1={modulePos.x - 8} y1={modulePos.y + offset} x2={modulePos.x} y2={modulePos.y + offset} />
            ))}
            {[30, 56, 82].map((offset) => (
              <line
                key={`epin-${offset}`}
                x1={espPos.x + ESP32_SIZE.w}
                y1={espPos.y + offset}
                x2={espPos.x + ESP32_SIZE.w + 8}
                y2={espPos.y + offset}
              />
            ))}
            {guests.map((device) => {
              const guestPos = pos(device.id);
              return [10, 24, 38].map((offset) => (
                <line
                  key={`gpin-${device.id}-${offset}`}
                  x1={guestPos.x - 8}
                  y1={guestPos.y + offset}
                  x2={guestPos.x}
                  y2={guestPos.y + offset}
                />
              ));
            })}
          </g>

          {homePos
            ? wanDevices.map((device) => {
                const wanPos = pos(device.id);
                return (
                  <line
                    key={`wan-${device.id}`}
                    className="link"
                    x1={wanPos.x + WAN_SIZE.w / 2}
                    y1={wanPos.y + WAN_SIZE.h / 2}
                    x2={homePos.x + HOME_SIZE.w / 2}
                    y2={homePos.y + HOME_SIZE.h / 2}
                  />
                );
              })
            : null}
          {homePos ? (
            <line className="link" x1={homePos.x + HOME_SIZE.w / 2} y1={homePos.y + HOME_SIZE.h / 2} x2={moduleCenter.x} y2={moduleCenter.y} />
          ) : null}
          <line
            className="link"
            x1={moduleCenter.x}
            y1={moduleCenter.y}
            x2={espCenter.x}
            y2={espCenter.y}
          />
          <text className="buslbl" x={(moduleCenter.x + espCenter.x) / 2} y={(moduleCenter.y + espCenter.y) / 2 - 10} textAnchor="middle">
            {adapter.bus === "none" ? "STA" : adapter.bus}
          </text>

          {guests.map((device) => {
            const guestPos = pos(device.id);
            const fromX = espPos.x + ESP32_SIZE.w;
            const fromY = espPos.y + ESP32_SIZE.h / 2;
            const toX = guestPos.x;
            const toY = guestPos.y + GUEST_SIZE.h / 2;
            const midX = (fromX + toX) / 2;
            return (
              <path
                key={`wifi-${device.id}`}
                className="link wifi"
                d={`M ${fromX} ${fromY} C ${midX} ${fromY} ${midX} ${toY} ${toX} ${toY}`}
                fill="none"
              />
            );
          })}

          {guests.length > 1
            ? (() => {
                const first = pos(guests[0].id);
                const last = pos(guests[guests.length - 1].id);
                const x1 = first.x + GUEST_SIZE.w;
                const y1 = first.y + GUEST_SIZE.h / 2;
                const x2 = last.x + GUEST_SIZE.w;
                const y2 = last.y + GUEST_SIZE.h / 2;
                const labelX = Math.min(Math.max(x1, x2) + 62, VIEW_W - 12);
                return (
                  <>
                    <path
                      className="link bypass"
                      d={`M ${x1} ${y1} C ${x1 + 64} ${y1 + 70} ${x2 + 64} ${y2 - 70} ${x2} ${y2}`}
                      fill="none"
                    />
                    <text
                      className="bypasslbl"
                      x={labelX}
                      y={(y1 + y2) / 2}
                      transform={`rotate(90 ${labelX} ${(y1 + y2) / 2})`}
                      textAnchor="middle"
                    >
                      AP relay · unfiltered
                    </text>
                  </>
                );
              })()
            : null}

          <rect className="board" x={boardFrame.x} y={boardFrame.y} width={boardFrame.w} height={boardFrame.h} rx="10" />
          <text className="boardlbl" x={boardFrame.x + 2} y={boardFrame.y - 6}>
            WARDEN32 BOARD · {upper(shortName(adapter.name))}
          </text>

          {wanDevices.map((device, index) => {
            const wanPos = pos(device.id);
            return (
              <g
                key={device.id}
                className={`node ${selectedId === device.id ? "selected" : ""}`}
                onPointerDown={(event) => startDrag(device.id, WAN_SIZE, device, event)}
              >
                <rect className="box" x={wanPos.x} y={wanPos.y} width={WAN_SIZE.w} height={WAN_SIZE.h} rx="7" />
                <text className="lbl" x={wanPos.x + WAN_SIZE.w / 2} y={wanPos.y + 19} textAnchor="middle">
                  {upper(device.name)}
                </text>
                <text className="sub" x={wanPos.x + WAN_SIZE.w / 2} y={wanPos.y + 33} textAnchor="middle">
                  {device.ipv4 ?? "—"}
                </text>
                <text className="ref" x={wanPos.x} y={wanPos.y - 4}>
                  {index === 0 ? "J1" : `W${index}`}
                </text>
              </g>
            );
          })}

          {home && homePos ? (
            <g
              className={`node ${selectedId === home.id ? "selected" : ""}`}
              onPointerDown={(event) => startDrag(home.id, HOME_SIZE, home, event)}
            >
              <rect className="box" x={homePos.x} y={homePos.y} width={HOME_SIZE.w} height={HOME_SIZE.h} rx="7" />
              <text className="lbl" x={homePos.x + HOME_SIZE.w / 2} y={homePos.y + 22} textAnchor="middle">
                HOME ROUTER
              </text>
              <text className="sub" x={homePos.x + HOME_SIZE.w / 2} y={homePos.y + 37} textAnchor="middle">
                {home.ipv4 ?? "—"}
              </text>
              <text className="ref" x={homePos.x} y={homePos.y - 6}>
                J2
              </text>
            </g>
          ) : null}

          <g
            className={`node ${router && selectedId === router.id ? "selected" : ""}`}
            onPointerDown={(event) => startDrag(MODULE_KEY, MODULE_SIZE, router, event)}
          >
            <rect className="box" x={modulePos.x} y={modulePos.y} width={MODULE_SIZE.w} height={MODULE_SIZE.h} rx="6" />
            <text className="lbl" x={moduleCenter.x} y={modulePos.y + 36} textAnchor="middle">
              {upper(shortName(adapter.name).split(" ")[0])}
            </text>
            <text className="sub" x={moduleCenter.x} y={modulePos.y + 51} textAnchor="middle">
              {adapter.bus === "none" ? "no PHY" : `${adapter.bus} · ${adapter.nominalMbps}M`}
            </text>
          </g>

          <g
            className={`node ${router && selectedId === router.id ? "selected" : ""}`}
            onPointerDown={(event) => startDrag(esp32Key, ESP32_SIZE, router, event)}
          >
            <rect className="box hot" x={espPos.x} y={espPos.y} width={ESP32_SIZE.w} height={ESP32_SIZE.h} rx="9" />
            <text className="lbl" x={espCenter.x} y={espPos.y + 34} textAnchor="middle">
              WARDEN32
            </text>
            <text className="sub" x={espCenter.x} y={espPos.y + 52} textAnchor="middle">
              ESP32 · {project.sim.firmwareId}
            </text>
            <text className="sub" x={espCenter.x} y={espPos.y + 67} textAnchor="middle">
              softAP · {router ? `${router.ipv4 ?? "—"}/${guestPrefix}` : "—"}
            </text>
            <text className="sub" x={espCenter.x} y={espPos.y + 82} textAnchor="middle">
              {board.name}
            </text>
            <text className="ref" x={espPos.x} y={espPos.y - 6}>
              U1
            </text>
          </g>

          {guests.map((device, index) => {
            const guestPos = pos(device.id);
            const verdict = verdictFor.get(device.id);
            const markerClass =
              verdict === "allowed"
                ? "p-ok"
                : verdict === "not-enforceable"
                  ? "p-warn"
                  : verdict
                    ? "p-bad"
                    : "";
            return (
              <g key={device.id}>
                <g
                  className={`node ${selectedId === device.id ? "selected" : ""}`}
                  onPointerDown={(event) => startDrag(device.id, GUEST_SIZE, device, event)}
                >
                  <rect className="box" x={guestPos.x} y={guestPos.y} width={GUEST_SIZE.w} height={GUEST_SIZE.h} rx="7" />
                  <text className="lbl" x={guestPos.x + GUEST_SIZE.w / 2} y={guestPos.y + 20} textAnchor="middle">
                    {upper(device.name)}
                  </text>
                  <text className="sub" x={guestPos.x + GUEST_SIZE.w / 2} y={guestPos.y + 35} textAnchor="middle">
                    {device.compromised ? `${device.ipv4 ?? "—"} · compromised` : device.ipv4 ?? "—"}
                  </text>
                  <text className="ref" x={guestPos.x} y={guestPos.y - 4}>
                    D{index + 1}
                  </text>
                </g>
                {markerClass ? (
                  <g key={`${device.id}-${results.length}`} className="mark">
                    <circle className={markerClass} cx={guestPos.x - 30} cy={guestPos.y + 24} r="4" />
                    {verdict !== "allowed" ? (
                      <text className="dropmark" x={guestPos.x - 30} y={guestPos.y + 12} textAnchor="middle">
                        ✕
                      </text>
                    ) : null}
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="float-toolbar">
        <span>uplink:</span>
        <select className="modesel" value={adapter.id} onChange={(event) => switchAdapter(event.target.value)}>
          {ETHERNET_ADAPTERS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <span className="dim">drag to move · click to inspect</span>
      </div>

      <div className="zoombar">
        <button className="zbtn" title="zoom in" onClick={() => setZoom((value) => Math.min(2, Number((value + 0.15).toFixed(2))))}>
          ＋
        </button>
        <button className="zbtn" title="zoom out" onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.15).toFixed(2))))}>
          −
        </button>
        <button className="zbtn" title="reset zoom" onClick={() => setZoom(1)}>
          ↺
        </button>
        <button className="zbtn" title="reset layout" onClick={resetLayout}>
          ⌗
        </button>
      </div>

      <div className="float-palette">
        <div className="fh">
          <span>uplink modules</span>
          <span>⠿</span>
        </div>
        <div className="fbody scroll">
          {ETHERNET_ADAPTERS.map((item) => (
            <button
              key={item.id}
              className={`fitem ${item.id === adapter.id ? "on" : ""}`}
              title={item.note}
              onClick={() => switchAdapter(item.id)}
            >
              {shortName(item.name)}
            </button>
          ))}
        </div>
        <div className="fh">
          <span>boards</span>
          <span>▮</span>
        </div>
        <div className="fbody scroll slim">
          {HARDWARE_PROFILES.map((item) => (
            <button
              key={item.id}
              className={`fitem wide ${item.id === board.id ? "on" : ""}`}
              title={item.note}
              onClick={() => switchBoard(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
