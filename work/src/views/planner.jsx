import { useMemo, useState } from "react";
import { useDB } from "../db.js";
import { childrenIndex, isClosed, spanOf, fmtDate, todayISO, descendants } from "../logic.js";
import { TaskRow, useApp } from "../item.jsx";
import { Empty } from "../ui.jsx";

const GROUPS = [
  ["standup", "In progress · standup"],
  ["mature", "In progress · mature"],
  ["planning", "Planning"],
  ["someday", "Someday"],
];

export function Planner() {
  const { db, create } = useDB();
  const { focusMatch, openItem } = useApp();
  const items = db.item;
  const idx = useMemo(() => childrenIndex(items), [items]);
  const areas = (idx[""] || []).filter((a) => a.kind === "area" && a.status !== "complete");
  const [areaId, setAreaId] = useState(() => {
    try {
      return localStorage.getItem("wb-area") || "all";
    } catch (e) {
      return "all";
    }
  });
  const pick = (id) => {
    setAreaId(id);
    try {
      localStorage.setItem("wb-area", id);
    } catch (e) {}
  };
  const shown = areaId === "all" ? areas : areas.filter((a) => a.id === areaId);
  const addArea = () => {
    const t = prompt("New area name (e.g. 🏥 ITP):");
    if (!t) return;
    const m = t.match(/^(\p{Extended_Pictographic}️?)\s*(.*)$/u);
    const a = create("item", { kind: "area", parent_id: null, title: m ? m[2] : t, emoji: m ? m[1] : "", sort: areas.length });
    pick(a.id);
  };
  const openCount = (a) => descendants(items, a.id, idx).filter((d) => d.kind === "task" && !isClosed(items, d) && focusMatch(d)).length;

  return (
    <div className="page planner">
      <div className="subnav">
        <button className={"subtab" + (areaId === "all" ? " on" : "")} onClick={() => pick("all")}>
          All areas
        </button>
        {areas.map((a) => (
          <button key={a.id} className={"subtab" + (areaId === a.id ? " on" : "")} onClick={() => pick(a.id)}>
            {a.emoji} {a.title} <span className="count">{openCount(a)}</span>
          </button>
        ))}
        <button className="subtab add" onClick={addArea}>
          + Area
        </button>
      </div>
      {!areas.length && <Empty>No areas yet. Add one (e.g. 🏡 OTP) to get started, or import your data from the ⋯ menu.</Empty>}
      {shown.map((a) => (
        <section key={a.id} className="area">
          <div className="area-h">
            <h2 onClick={() => openItem(a.id)}>
              {a.emoji} {a.title}
            </h2>
            {a.description && <p className="muted">{a.description}</p>}
            <button
              className="btn ghost small"
              onClick={() => {
                const t = prompt(`New workstream in ${a.title} (start with an emoji if you like):`);
                if (!t) return;
                const m = t.match(/^(\p{Extended_Pictographic}️?)\s*(.*)$/u);
                create("item", { kind: "stream", parent_id: a.id, title: m ? m[2] : t, emoji: m ? m[1] : "", sort: (idx[a.id] || []).length, priority_ids: [] });
              }}
            >
              + Workstream
            </button>
          </div>
          <div className="streams">
            {(idx[a.id] || [])
              .filter((s) => s.status !== "complete")
              .map((s) => (s.kind === "stream" ? <StreamCard key={s.id} s={s} idx={idx} /> : <LooseTask key={s.id} it={s} />))}
          </div>
        </section>
      ))}
    </div>
  );
}

function LooseTask({ it }) {
  return (
    <div className="stream loose">
      <TaskRow it={it} />
    </div>
  );
}

function StreamCard({ s, idx }) {
  const { db, create, updateItem, patch } = useDB();
  const { focusMatch, openItem, focusActive } = useApp();
  const items = db.item;
  const tasks = (idx[s.id] || []).filter((t) => t.kind === "task" && t.status !== "complete");
  const visible = tasks.filter((t) => focusMatch(t, true));
  const [showSomeday, setShowSomeday] = useState(false);
  const [adding, setAdding] = useState("");
  const [over, setOver] = useState(null);
  const span = spanOf(items, s.id, idx);
  const done = (idx[s.id] || []).filter((t) => t.status === "complete").length;
  const overdue = descendants(items, s.id, idx).filter((d) => d.kind === "task" && !isClosed(items, d) && d.due && d.due < todayISO()).length;
  const prios = (s.priority_ids || []).map((p) => db.priority[p]).filter(Boolean);
  if (focusActive && !visible.length) return null;

  const add = (status) => {
    const t = adding.trim();
    if (!t) return;
    create("item", { kind: "task", parent_id: s.id, title: t, status, owners: [], start: todayISO(), due: null, blocked_by: [], sort: Date.now() });
    setAdding("");
  };
  const drop = (e, status) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/item");
    const it = items[id];
    if (!it) return;
    if (it.parent_id !== s.id) patch("item", id, { parent_id: s.id });
    if (it.status !== status) updateItem(id, { status });
  };

  return (
    <div className="stream">
      <div className="stream-h" onClick={() => openItem(s.id)}>
        <div className="stream-t">
          <span className="emoji">{s.emoji}</span>
          <span>{s.title}</span>
          {s.private && <span title="Private">🔒</span>}
        </div>
        <div className="stream-meta">
          <span>{tasks.length} open</span>
          {done > 0 && <span>{done} done</span>}
          {overdue > 0 && <span className="over">{overdue} overdue</span>}
          {span.start && (
            <span>
              {fmtDate(span.start)} → {fmtDate(span.end)}
            </span>
          )}
        </div>
        {prios.length > 0 && (
          <div className="stream-prios">
            {prios.map((p) => (
              <span key={p.id} className="tag sm">
                {p.emoji} {p.title}
              </span>
            ))}
          </div>
        )}
      </div>
      {GROUPS.map(([st, label]) => {
        const list = visible.filter((t) => (t.status || "planning") === st);
        if (st === "someday" && !list.length) return null;
        const collapsed = st === "someday" && !showSomeday;
        if (!list.length && st !== "planning")
          return (
            <div
              key={st}
              className={"dropzone thin" + (over === st ? " over" : "")}
              onDragOver={(e) => (e.preventDefault(), setOver(st))}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => drop(e, st)}
            >
              {over === st ? `Drop into ${label}` : ""}
            </div>
          );
        return (
          <div
            key={st}
            className={"sgroup" + (over === st ? " over" : "")}
            onDragOver={(e) => (e.preventDefault(), setOver(st))}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => drop(e, st)}
          >
            <button className="sgroup-h" onClick={() => st === "someday" && setShowSomeday(!showSomeday)}>
              <span className={"dot st-" + st} />
              {label}
              <span className="count">{list.length}</span>
              {st === "someday" && <span className="muted small">{collapsed ? "show" : "hide"}</span>}
            </button>
            {!collapsed &&
              list.map((t) => (
                <TaskRow key={t.id} it={t} draggable onDragStart={(e) => e.dataTransfer.setData("text/item", t.id)} />
              ))}
          </div>
        );
      })}
      <input
        className="add-input"
        placeholder="+ Add item (Enter = planning, Shift+Enter = in progress)"
        value={adding}
        onChange={(e) => setAdding(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add(e.shiftKey ? "standup" : "planning")}
      />
    </div>
  );
}
