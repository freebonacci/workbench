import { useMemo, useRef, useState, useEffect } from "react";
import { useDB } from "../db.js";
import { openTasks, addDays, diffDays, todayISO, fmtDate, ancestors, monthLabel, dow, streamOf, areaOf, childrenIndex, openBlockers } from "../logic.js";
import { useApp } from "../item.jsx";
import { OwnerChips, Empty } from "../ui.jsx";

const ROW = 34;
const labelW = () => (window.innerWidth < 900 ? 170 : 280);
const ZOOMS = { week: 30, month: 12, quarter: 5 };

export function Gantt() {
  const { db, updateItem } = useDB();
  const { focusMatch, openItem } = useApp();
  const items = db.item;
  const [groupBy, setGroupBy] = useState(() => lsGet("wb-gantt-group", "stream"));
  const [zoom, setZoom] = useState(() => lsGet("wb-gantt-zoom", "month"));
  const [drag, setDrag] = useState(null); // {id, mode, x0, ds, dd}
  const scroller = useRef(null);
  const ppd = ZOOMS[zoom];
  const LW = labelW();
  const today = todayISO();
  useEffect(() => lsSet("wb-gantt-group", groupBy), [groupBy]);
  useEffect(() => lsSet("wb-gantt-zoom", zoom), [zoom]);

  const all = useMemo(() => openTasks(items).filter((t) => focusMatch(t)), [items, focusMatch]);
  const dated = all.filter((t) => t.due);
  const undated = all.length - dated.length;

  // effective dates while dragging
  const eff = (t) => {
    let s = t.start || t.due,
      e = t.due || t.start;
    if (drag && drag.id === t.id) {
      if (drag.mode !== "end") s = addDays(s, drag.dd);
      if (drag.mode !== "start") e = addDays(e, drag.dd);
      if (e < s) drag.mode === "end" ? (e = s) : (s = e);
    }
    return { s, e };
  };

  // timeline range
  let lo = addDays(today, -21),
    hi = addDays(today, 70);
  for (const t of dated) {
    const { s, e } = eff(t);
    if (s < lo) lo = s;
    if (e > hi) hi = e;
  }
  lo = addDays(lo, -((dow(lo) + 6) % 7) - 7);
  hi = addDays(hi, 21);
  const days = diffDays(hi, lo) + 1;
  const width = days * ppd;
  const x = (iso) => diffDays(iso, lo) * ppd;

  // rows
  const rows = useMemo(() => {
    const out = [];
    const byDue = (a, b) => (a.due || a.start || "").localeCompare(b.due || b.start || "");
    if (groupBy === "deadline") {
      [...dated].sort(byDue).forEach((t) => out.push({ t }));
    } else if (groupBy === "person") {
      const ppl = Object.values(db.person).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
      for (const p of ppl) {
        const l = dated.filter((t) => (t.owners || []).includes(p.id)).sort(byDue);
        if (!l.length) continue;
        out.push({ head: p.name, person: p });
        l.forEach((t) => out.push({ t, key: p.id }));
      }
      const none = dated.filter((t) => !(t.owners || []).length).sort(byDue);
      if (none.length) {
        out.push({ head: "No owner" });
        none.forEach((t) => out.push({ t, key: "none" }));
      }
    } else {
      const idx = childrenIndex(items);
      const order = new Map();
      let n = 0;
      const walk = (pid) => (idx[pid] || []).forEach((c) => (order.set(c.id, n++), walk(c.id)));
      walk("");
      const g = new Map();
      for (const t of dated) {
        const s = streamOf(items, t.id) || areaOf(items, t.id);
        const k = s ? s.id : "";
        if (!g.has(k)) g.set(k, []);
        g.get(k).push(t);
      }
      [...g.entries()]
        .sort((a, b) => (order.get(a[0]) ?? 1e9) - (order.get(b[0]) ?? 1e9))
        .forEach(([k, l]) => {
          const s = items[k];
          const a = s ? areaOf(items, s.id) : null;
          out.push({ head: s ? `${a ? (a.emoji || "") + " " + a.title + " › " : ""}${s.emoji || ""} ${s.title}` : "Other" });
          l.sort((p, q) => (order.get(p.id) ?? 0) - (order.get(q.id) ?? 0)).forEach((t) => out.push({ t, key: k }));
        });
    }
    return out;
  }, [dated, groupBy, items, db.person]);

  // first row index per item for arrows
  const rowOf = new Map();
  rows.forEach((r, i) => r.t && !rowOf.has(r.t.id) && rowOf.set(r.t.id, i));

  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, x(today) - LW);
    // eslint-disable-next-line
  }, [zoom, groupBy]);

  // drag handling
  const dragRef = useRef(null);
  dragRef.current = drag;
  useEffect(() => {
    if (!drag) return;
    const move = (e) => setDrag((d) => d && { ...d, dd: Math.round((e.clientX - d.x0) / ppd), moved: d.moved || Math.abs(e.clientX - d.x0) > 3 });
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      const t = items[d.id];
      if (!t) return;
      if (!d.moved) return openItem(d.id);
      if (!d.dd) return;
      const p = {};
      if (t.start && t.due) {
        const r = effFor(t, d);
        p.start = r.s;
        p.due = r.e;
      } else if (t.due) p.due = addDays(t.due, d.dd);
      else p.start = addDays(t.start, d.dd);
      updateItem(d.id, p);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line
  }, [drag?.id, ppd, items]);

  // header: months + days/weeks
  const months = [];
  for (let d = lo; d <= hi; d = addDays(d, 1)) {
    if (d === lo || d.endsWith("-01")) months.push(d);
  }
  const ticks = [];
  for (let d = lo; d <= hi; d = addDays(d, zoom === "week" ? 1 : 7)) ticks.push(d);

  return (
    <div className="page gantt">
      <div className="toolbar">
        <div className="seg">
          {[
            ["stream", "By stream"],
            ["person", "By person"],
            ["deadline", "By deadline"],
          ].map(([k, l]) => (
            <button key={k} className={"seg-b" + (groupBy === k ? " on" : "")} onClick={() => setGroupBy(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="seg">
          {Object.keys(ZOOMS).map((z) => (
            <button key={z} className={"seg-b" + (zoom === z ? " on" : "")} onClick={() => setZoom(z)}>
              {z[0].toUpperCase() + z.slice(1)}
            </button>
          ))}
        </div>
        <button className="btn ghost" onClick={() => scroller.current && (scroller.current.scrollLeft = Math.max(0, x(today) - LW))}>
          Today
        </button>
        <span className="muted small toolbar-r">
          Drag a bar to move it, or its edges to change start/deadline. {undated > 0 && `${undated} open item${undated > 1 ? "s" : ""} without a deadline not shown.`}
        </span>
      </div>
      {!rows.length ? (
        <Empty>No dated items to chart{focusMatch.active ? " for this filter" : ""}.</Empty>
      ) : (
        <div className="gantt-scroll" ref={scroller}>
          <div className="gantt-inner" style={{ width: width + LW }}>
            <div className="g-head" style={{ width: width + LW }}>
              <div className="g-label g-corner">Item</div>
              <div className="g-scale" style={{ width }}>
                {months.map((m) => (
                  <div key={m} className="g-month" style={{ left: x(m) }}>
                    {monthLabel(m)}
                  </div>
                ))}
                {ticks.map((d) => (
                  <div key={d} className={"g-tick" + (dow(d) === 1 ? " mon" : "")} style={{ left: x(d) }}>
                    {zoom === "week" ? d.slice(8) : d.slice(8) * 1}
                  </div>
                ))}
              </div>
            </div>
            <div className="g-body" style={{ height: rows.length * ROW }}>
              <div className="g-grid" style={{ left: LW, width, height: rows.length * ROW }}>
                {ticks.map((d) => (
                  <div key={d} className={"g-line" + (dow(d) === 1 ? " mon" : "")} style={{ left: x(d) }} />
                ))}
                <div className="g-today" style={{ left: x(today) + ppd / 2 }} title="Today" />
              </div>
              {rows.map((r, i) =>
                r.head ? (
                  <div key={"h" + i} className="g-row head" style={{ top: i * ROW }}>
                    <div className="g-label">{r.head}</div>
                  </div>
                ) : (
                  <GanttRow key={r.t.id + (r.key || "")} r={r} i={i} x={x} ppd={ppd} eff={eff} today={today} items={items} onDown={(e, mode) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDrag({ id: r.t.id, mode, x0: e.clientX, dd: 0 });
                  }} openItem={openItem} />
                )
              )}
              <svg className="g-arrows" style={{ left: LW, width, height: rows.length * ROW }} width={width} height={rows.length * ROW}>
                <defs>
                  <marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
                  </marker>
                </defs>
                {rows.map((r, i) => {
                  if (!r.t || rowOf.get(r.t.id) !== i) return null;
                  return openBlockers(items, r.t).map((b) => {
                    const j = rowOf.get(b.id);
                    if (j == null) return null;
                    const be = eff(b).e,
                      ts = eff(r.t).s;
                    const x1 = x(be) + ppd,
                      y1 = j * ROW + ROW / 2,
                      x2 = x(ts),
                      y2 = i * ROW + ROW / 2;
                    const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 14));
                    const bad = ts <= be;
                    return (
                      <path
                        key={b.id + ">" + r.t.id}
                        className={"g-arrow" + (bad ? " bad" : "")}
                        d={`M${x1},${y1} H${mid} V${y2} H${x2 - 1}`}
                        markerEnd="url(#ah)"
                      />
                    );
                  });
                })}
              </svg>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function effFor(t, d) {
  let s = t.start || t.due,
    e = t.due || t.start;
  if (d.mode !== "end") s = addDays(s, d.dd);
  if (d.mode !== "start") e = addDays(e, d.dd);
  if (e < s) d.mode === "end" ? (e = s) : (s = e);
  return { s, e };
}

function GanttRow({ r, i, x, ppd, eff, today, items, onDown, openItem }) {
  const t = r.t;
  const { s, e } = eff(t);
  const milestone = !t.start || !t.due;
  const over = t.due && t.due < today;
  const waiting = openBlockers(items, t).length > 0;
  const path = ancestors(items, t.id).filter((a) => a.kind === "task").map((a) => a.title);
  return (
    <div className="g-row" style={{ top: i * ROW }}>
      <div className="g-label" onClick={() => openItem(t.id)} title={t.title}>
        <span className="g-t" title={path.length ? path.join(" › ") + " › " + t.title : t.title}>
          {path.length ? <span className="muted">↳ </span> : null}
          {t.title}
        </span>
        <OwnerChips ids={t.owners} max={2} />
      </div>
      <div className="g-lane">
        {milestone ? (
          <div
            className={"g-ms st-" + t.status + (over ? " over" : "")}
            style={{ left: x(s) + ppd / 2 - 7 }}
            title={`${t.title}\n${t.due ? "Deadline " + fmtDate(t.due) : "Starts " + fmtDate(t.start) + " (no deadline)"}`}
            onPointerDown={(ev) => onDown(ev, "move")}
          />
        ) : (
          <div
            className={"g-bar st-" + t.status + (over ? " over" : "") + (waiting ? " waiting" : "")}
            style={{ left: x(s), width: Math.max(ppd, (diffDays(e, s) + 1) * ppd) }}
            title={`${t.title}\n${fmtDate(s)} → ${fmtDate(e)}`}
            onPointerDown={(ev) => onDown(ev, "move")}
          >
            <span className="g-h l" onPointerDown={(ev) => onDown(ev, "start")} />
            <span className="g-bar-t">{t.title}</span>
            <span className="g-h r" onPointerDown={(ev) => onDown(ev, "end")} />
          </div>
        )}
      </div>
    </div>
  );
}

const lsGet = (k, d) => {
  try {
    return localStorage.getItem(k) || d;
  } catch (e) {
    return d;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch (e) {}
};
