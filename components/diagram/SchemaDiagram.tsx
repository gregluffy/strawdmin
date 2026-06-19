"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import type { Schema, SchemaTable } from "@/lib/types";
import { basePath } from "@/lib/api-url";

const TABLE_W = 240;
const HEADER_H = 40;
const ROW_H = 26;
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 4;

function tableHeight(t: SchemaTable) {
  return HEADER_H + t.columns.length * ROW_H;
}

function initialLayout(tables: SchemaTable[]): Record<string, { x: number; y: number }> {
  const n = tables.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const maxH = tables.reduce((m, t) => Math.max(m, tableHeight(t)), HEADER_H + ROW_H);
  const out: Record<string, { x: number; y: number }> = {};
  tables.forEach((t, i) => {
    out[t.name] = {
      x: 40 + (i % cols) * (TABLE_W + 100),
      y: 40 + Math.floor(i / cols) * (maxH + 80),
    };
  });
  return out;
}

interface Relation {
  fromTable: string;
  fromColIdx: number;
  toTable: string;
  toColIdx: number;
  label: string; // "tableName.colName → refTable.refCol"
}

function buildRelations(tables: SchemaTable[]): Relation[] {
  const rels: Relation[] = [];
  for (const t of tables) {
    t.columns.forEach((c, ci) => {
      if (!c.fk) return;
      const toTable = tables.find((x) => x.name === c.fk!.table);
      if (!toTable) return;
      const toColIdx = toTable.columns.findIndex((x) => x.name === c.fk!.column);
      if (toColIdx < 0) return;
      rels.push({
        fromTable: t.name,
        fromColIdx: ci,
        toTable: c.fk.table,
        toColIdx,
        label: `${t.name}.${c.name} → ${c.fk.table}.${c.fk.column}`,
      });
    });
  }
  return rels;
}

function bezierD(fx: number, fy: number, tx: number, ty: number): string {
  const cp = Math.abs(tx - fx) * 0.5 + 20;
  const fromRight = fx < tx;
  const c1x = fx + (fromRight ? cp : -cp);
  const c2x = tx - (fromRight ? cp : -cp);
  return `M ${fx} ${fy} C ${c1x} ${fy} ${c2x} ${ty} ${tx} ${ty}`;
}

// Light-theme colors for PNG export (CSS vars don't serialize)
const EXPORT_C = {
  bg: "#f8fafc",
  card: "#ffffff",
  border: "#cbd5e1",
  header: "#6366f1",
  headerText: "#ffffff",
  pk: "#f59e0b",
  fk: "#6366f1",
  text: "#1e293b",
  muted: "#64748b",
  rowAlt: "#f1f5f9",
  line: "#6366f1",
};

type Positions = Record<string, { x: number; y: number }>;

export function SchemaDiagram({ schema, savedPositions }: { schema: Schema; savedPositions?: Positions }) {
  const tables = schema.tables;
  const relations = useMemo(() => buildRelations(tables), [tables]);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [positions, setPositions] = useState<Positions>(() => {
    const layout = initialLayout(tables);
    if (!savedPositions || Object.keys(savedPositions).length === 0) return layout;
    // Use saved position for known tables; fall back to grid placement for new ones
    const merged: Positions = {};
    for (const t of tables) {
      merged[t.name] = savedPositions[t.name] ?? layout[t.name];
    }
    return merged;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 20, y: 20 });

  // Mirrors of state for use in event handlers (avoids stale closure re-attachment)
  const liveRef = useRef({ positions, zoom, pan });
  liveRef.current = { positions, zoom, pan };

  const dragging = useRef<{ table: string; startMx: number; startMy: number; origX: number; origY: number } | null>(null);
  const panning = useRef<{ startMx: number; startMy: number; origPanX: number; origPanY: number } | null>(null);

  const clientToSvg = (cx: number, cy: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const { pan, zoom } = liveRef.current;
    return { x: (cx - rect.left - pan.x) / zoom, y: (cy - rect.top - pan.y) / zoom };
  };

  const hitTable = (sx: number, sy: number): string | null => {
    for (const t of tables) {
      const p = liveRef.current.positions[t.name];
      if (!p) continue;
      if (sx >= p.x && sx <= p.x + TABLE_W && sy >= p.y && sy <= p.y + tableHeight(t)) return t.name;
    }
    return null;
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const sp = clientToSvg(e.clientX, e.clientY);
    const hit = hitTable(sp.x, sp.y);
    if (hit) {
      const pos = liveRef.current.positions[hit];
      dragging.current = { table: hit, startMx: e.clientX, startMy: e.clientY, origX: pos.x, origY: pos.y };
    } else {
      const { pan } = liveRef.current;
      panning.current = { startMx: e.clientX, startMy: e.clientY, origPanX: pan.x, origPanY: pan.y };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current) {
        const { table, startMx, startMy, origX, origY } = dragging.current;
        const z = liveRef.current.zoom;
        setPositions((p) => ({ ...p, [table]: { x: origX + (e.clientX - startMx) / z, y: origY + (e.clientY - startMy) / z } }));
      } else if (panning.current) {
        const { startMx, startMy, origPanX, origPanY } = panning.current;
        setPan({ x: origPanX + e.clientX - startMx, y: origPanY + e.clientY - startMy });
      }
    };
    const onUp = () => { dragging.current = null; panning.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setZoom((z) => {
        const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
        setPan((p) => ({ x: mx - (mx - p.x) * (nz / z), y: my - (my - p.y) * (nz / z) }));
        return nz;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const fitScreen = useCallback(() => {
    const el = containerRef.current;
    if (!el || tables.length === 0) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of tables) {
      const p = positions[t.name]; if (!p) continue;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + TABLE_W); y1 = Math.max(y1, p.y + tableHeight(t));
    }
    const pad = 48;
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((el.clientWidth - pad * 2) / (x1 - x0), (el.clientHeight - pad * 2) / (y1 - y0))));
    setPan({ x: (el.clientWidth - (x1 - x0) * nz) / 2 - x0 * nz, y: (el.clientHeight - (y1 - y0) * nz) / 2 - y0 * nz });
    setZoom(nz);
  }, [tables, positions]);

  const exportPng = useCallback(() => {
    if (tables.length === 0) return;
    const pad = 48;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of tables) {
      const p = positions[t.name]; if (!p) continue;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + TABLE_W); y1 = Math.max(y1, p.y + tableHeight(t));
    }
    const scale = 2;
    const cw = (x1 - x0 + pad * 2) * scale;
    const ch = (y1 - y0 + pad * 2) * scale;
    const canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.translate(pad - x0, pad - y0);

    // Background + dot grid
    ctx.fillStyle = EXPORT_C.bg;
    ctx.fillRect(x0 - pad, y0 - pad, cw / scale, ch / scale);
    ctx.fillStyle = "#cbd5e1";
    for (let gx = Math.floor((x0 - pad) / 20) * 20; gx < x1 + pad; gx += 20)
      for (let gy = Math.floor((y0 - pad) / 20) * 20; gy < y1 + pad; gy += 20) {
        ctx.beginPath(); ctx.arc(gx, gy, 1, 0, Math.PI * 2); ctx.fill();
      }

    // Relations
    ctx.strokeStyle = EXPORT_C.line; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.globalAlpha = 0.7;
    for (const rel of relations) {
      const fp = positions[rel.fromTable]; const tp = positions[rel.toTable]; if (!fp || !tp) continue;
      const fy = fp.y + HEADER_H + rel.fromColIdx * ROW_H + ROW_H / 2;
      const ty = tp.y + HEADER_H + rel.toColIdx * ROW_H + ROW_H / 2;
      const fromRight = fp.x + TABLE_W / 2 < tp.x + TABLE_W / 2;
      const fx = fromRight ? fp.x + TABLE_W : fp.x;
      const tx = fromRight ? tp.x : tp.x + TABLE_W;
      const cp = Math.abs(tx - fx) * 0.5 + 20;
      ctx.beginPath(); ctx.moveTo(fx, fy);
      ctx.bezierCurveTo(fx + (fromRight ? cp : -cp), fy, tx - (fromRight ? cp : -cp), ty, tx, ty);
      ctx.stroke();
      // Arrowhead
      const ang = Math.atan2(ty - fy, tx - fx);
      ctx.setLineDash([]); ctx.fillStyle = EXPORT_C.line;
      ctx.beginPath(); ctx.moveTo(tx, ty);
      ctx.lineTo(tx - 8 * Math.cos(ang - 0.4), ty - 8 * Math.sin(ang - 0.4));
      ctx.lineTo(tx - 8 * Math.cos(ang + 0.4), ty - 8 * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fill(); ctx.setLineDash([4, 3]);
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);

    // Tables
    for (const t of tables) {
      const p = positions[t.name]; if (!p) continue;
      const th = tableHeight(t);
      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.07)";
      roundRect(ctx, p.x + 3, p.y + 3, TABLE_W, th, 8); ctx.fill();
      // Card
      ctx.fillStyle = EXPORT_C.card; ctx.strokeStyle = EXPORT_C.border; ctx.lineWidth = 1;
      roundRect(ctx, p.x, p.y, TABLE_W, th, 8); ctx.fill(); ctx.stroke();
      // Header
      ctx.fillStyle = EXPORT_C.header;
      roundRect(ctx, p.x, p.y, TABLE_W, HEADER_H, [8, 8, 0, 0]); ctx.fill();
      ctx.fillStyle = EXPORT_C.headerText; ctx.font = "bold 13px monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(ellipsis(t.name, 22), p.x + TABLE_W / 2, p.y + HEADER_H / 2, TABLE_W - 16);
      // Columns
      for (let ci = 0; ci < t.columns.length; ci++) {
        const c = t.columns[ci];
        const cy = p.y + HEADER_H + ci * ROW_H;
        if (ci % 2 === 1) { ctx.fillStyle = EXPORT_C.rowAlt; ctx.fillRect(p.x, cy, TABLE_W, ROW_H); }
        ctx.strokeStyle = EXPORT_C.border; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(p.x, cy + ROW_H); ctx.lineTo(p.x + TABLE_W, cy + ROW_H); ctx.stroke();
        if (c.isPrimary) { ctx.fillStyle = EXPORT_C.pk; } else if (c.fk) { ctx.fillStyle = EXPORT_C.fk; }
        else { ctx.fillStyle = "transparent"; }
        ctx.font = "bold 9px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        if (c.isPrimary || c.fk) ctx.fillText(c.isPrimary ? "PK" : "FK", p.x + 8, cy + ROW_H / 2);
        ctx.fillStyle = EXPORT_C.text; ctx.font = `${c.isPrimary ? "bold " : ""}12px monospace`;
        ctx.fillText(ellipsis(c.name, 14), p.x + 30, cy + ROW_H / 2, TABLE_W - 90);
        ctx.fillStyle = EXPORT_C.muted; ctx.font = "10px monospace"; ctx.textAlign = "right";
        ctx.fillText(ellipsis(c.type, 12), p.x + TABLE_W - 8, cy + ROW_H / 2, 80);
      }
    }

    const link = document.createElement("a");
    link.download = `${schema.dbName}-diagram.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [tables, positions, relations, schema.dbName]);

  const savePositions = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`${basePath}/api/diagram-positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(positions),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }, [positions]);

  const toolbarButtons = [
    { label: "+", title: "Zoom in",      fn: () => setZoom((z) => Math.min(MAX_ZOOM, z * 1.2)) },
    { label: "−", title: "Zoom out",     fn: () => setZoom((z) => Math.max(MIN_ZOOM, z / 1.2)) },
    { label: "⊡", title: "Fit to screen", fn: fitScreen },
    { label: "↓", title: "Export PNG",   fn: exportPng },
  ];

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden select-none"
      style={{
        background: "var(--background)",
        backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
        cursor: "grab",
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Toolbar */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
        {toolbarButtons.map((btn) => (
          <button
            key={btn.title}
            onClick={btn.fn}
            title={btn.title}
            className="w-8 h-8 rounded bg-[var(--card)] border border-[var(--border)] hover:bg-[var(--accent)] text-[var(--foreground)] text-sm flex items-center justify-center shadow-sm transition-colors"
          >
            {btn.label}
          </button>
        ))}
        <button
          onClick={savePositions}
          disabled={saving}
          title="Save positions"
          className={`w-8 h-8 rounded border text-sm flex items-center justify-center shadow-sm transition-colors disabled:opacity-40 ${
            saved
              ? "bg-green-500/15 border-green-500/40 text-green-600 dark:text-green-400"
              : "bg-[var(--card)] border-[var(--border)] hover:bg-[var(--accent)] text-[var(--foreground)]"
          }`}
        >
          {saving ? "…" : saved ? "✓" : "💾"}
        </button>
      </div>

      {/* Zoom badge */}
      <div className="absolute bottom-3 right-3 z-10 px-2 py-1 bg-[var(--card)] border border-[var(--border)] rounded text-xs text-[var(--muted-foreground)] shadow-sm tabular-nums">
        {Math.round(zoom * 100)}%
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-10 px-3 py-2 bg-[var(--card)] border border-[var(--border)] rounded text-xs text-[var(--muted-foreground)] shadow-sm flex items-center gap-4 pointer-events-none">
        <span className="flex items-center gap-1">
          <span className="font-bold font-mono" style={{ color: "#f59e0b" }}>PK</span>
          <span>Primary key</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="font-bold font-mono text-[var(--primary)]">FK</span>
          <span>Foreign key</span>
        </span>
        <span className="flex items-center gap-1">
          <span
            style={{ display: "inline-block", width: 20, height: 2, background: "var(--primary)", opacity: 0.75, verticalAlign: "middle" }}
          />
          <span>Relation</span>
        </span>
        <span>Drag tables · Scroll to zoom</span>
      </div>

      <svg ref={svgRef} width="100%" height="100%">
        <defs>
          <marker id="dia-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" style={{ fill: "var(--primary)" }} opacity={0.8} />
          </marker>
        </defs>
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* Relation lines — drawn under tables */}
          {relations.map((rel, i) => {
            const fp = positions[rel.fromTable];
            const tp = positions[rel.toTable];
            if (!fp || !tp) return null;
            const fy = fp.y + HEADER_H + rel.fromColIdx * ROW_H + ROW_H / 2;
            const ty = tp.y + HEADER_H + rel.toColIdx * ROW_H + ROW_H / 2;
            const fromRight = fp.x + TABLE_W / 2 < tp.x + TABLE_W / 2;
            const fx = fromRight ? fp.x + TABLE_W : fp.x;
            const tx = fromRight ? tp.x : tp.x + TABLE_W;
            return (
              <g key={i}>
                {/* Invisible wider hit area for tooltip */}
                <title>{rel.label}</title>
                <path
                  d={bezierD(fx, fy, tx, ty)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={10}
                />
                <path
                  d={bezierD(fx, fy, tx, ty)}
                  fill="none"
                  style={{ stroke: "var(--primary)" }}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  opacity={0.75}
                  markerEnd="url(#dia-arrow)"
                />
              </g>
            );
          })}

          {/* Tables */}
          {tables.map((t) => {
            const p = positions[t.name] ?? { x: 0, y: 0 };
            const th = tableHeight(t);
            return (
              <g key={t.name} transform={`translate(${p.x},${p.y})`} style={{ cursor: "grab" }}>
                {/* Shadow */}
                <rect x={3} y={3} width={TABLE_W} height={th} rx={7} style={{ fill: "rgba(0,0,0,0.09)" }} />
                {/* Card body */}
                <rect x={0} y={0} width={TABLE_W} height={th} rx={7} style={{ fill: "var(--card)", stroke: "var(--border)" }} strokeWidth={1} />
                {/* Header background */}
                <rect x={0} y={0} width={TABLE_W} height={HEADER_H} rx={7} style={{ fill: "var(--primary)" }} />
                {/* Flatten bottom corners of header */}
                <rect x={0} y={HEADER_H - 8} width={TABLE_W} height={8} style={{ fill: "var(--primary)" }} />
                {/* Table name */}
                <text
                  x={TABLE_W / 2}
                  y={HEADER_H / 2 + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fill: "white", fontSize: 13, fontWeight: "bold", fontFamily: "monospace" }}
                >
                  {ellipsis(t.name, 22)}
                </text>

                {/* Columns */}
                {t.columns.map((c, ci) => {
                  const cy = HEADER_H + ci * ROW_H;
                  return (
                    <g key={c.name}>
                      {ci % 2 === 1 && (
                        <rect x={1} y={cy} width={TABLE_W - 2} height={ROW_H} style={{ fill: "var(--muted)" }} opacity={0.4} />
                      )}
                      <line x1={1} y1={cy} x2={TABLE_W - 1} y2={cy} style={{ stroke: "var(--border)" }} strokeWidth={0.5} />
                      {/* PK / FK badge */}
                      {(c.isPrimary || c.fk) && (
                        <text
                          x={9}
                          y={cy + ROW_H / 2 + 1}
                          dominantBaseline="middle"
                          style={{
                            fill: c.isPrimary ? "#f59e0b" : "var(--primary)",
                            fontSize: 9,
                            fontWeight: "bold",
                            fontFamily: "monospace",
                          }}
                        >
                          {c.isPrimary ? "PK" : "FK"}
                        </text>
                      )}
                      {/* Column name */}
                      <text
                        x={30}
                        y={cy + ROW_H / 2 + 1}
                        dominantBaseline="middle"
                        style={{
                          fill: "var(--foreground)",
                          fontSize: 12,
                          fontWeight: c.isPrimary ? "bold" : "normal",
                          fontFamily: "monospace",
                        }}
                      >
                        {ellipsis(c.name, 14)}
                      </text>
                      {/* Column type */}
                      <text
                        x={TABLE_W - 8}
                        y={cy + ROW_H / 2 + 1}
                        dominantBaseline="middle"
                        textAnchor="end"
                        style={{ fill: "var(--muted-foreground)", fontSize: 10, fontFamily: "monospace" }}
                      >
                        {ellipsis(c.type, 12)}
                      </text>
                      {/* Nullable dot */}
                      {c.nullable && (
                        <circle
                          cx={TABLE_W - 5}
                          cy={cy + ROW_H / 2 + 1}
                          r={2}
                          style={{ fill: "var(--muted-foreground)" }}
                          opacity={0.4}
                        />
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>

      {tables.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-[var(--muted-foreground)] text-sm">No tables found in this database.</p>
        </div>
      )}
    </div>
  );
}

function ellipsis(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Canvas helper — polyfills roundRect for environments that lack it
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  radii: number | [number, number, number, number]
) {
  const [tl, tr, br, bl] = Array.isArray(radii) ? radii : [radii, radii, radii, radii];
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}
