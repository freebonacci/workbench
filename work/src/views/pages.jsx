import { useMemo, useState, useEffect } from "react";
import { useDB } from "../db.js";
import {
  openTasks, bucketOf, BUCKETS, childrenIndex, descendants, isClosed, todayISO, fmtDate, pathLabel, monthLabel, STATUS,
} from "../logic.js";
import { TaskRow, useApp } from "../item.jsx";
import { Avatar, OwnerChips, DueChip, Empty, AutoText, InlineInput, PeoplePicker, StatusPill, copyText } from "../ui.jsx";

/* =============================== LIST =============================== */
export function ListView() {
  const { db } = useDB();
  const { focusMatch } = useApp();
  const [status, setStatus] = useState("active");
  const tasks = useMemo(
    () =>
      openTasks(db.item)
        .filter((t) => focusMatch(t))
        .filter((t) => (status === "active" ? t.status !== "someday" : t.status === status)),
    [db.item, focusMatch, status]
  );
  return (
    <div className="page list">
      <div className="toolbar">
        <div className="seg">
          {[
            ["active", "Everything live"],
            ["planning", "To plan"],
            ["standup", "Starting"],
            ["mature", "Progressing"],
          ].map(([k, l]) => (
            <button key={k} className={"seg-b" + (status === k ? " on" : "")} onClick={() => setStatus(k)}>
              {l}
            </button>
          ))}
        </div>
        <span className="muted small toolbar-r">{tasks.length} items</span>
      </div>
      {BUCKETS.map(([b, label]) => {
        const l = tasks.filter((t) => bucketOf(t.due) === b).sort((x, y) => (x.due || "").localeCompare(y.due || "") || x.title.localeCompare(y.title));
        if (!l.length) return null;
        return (
          <section key={b} className={"lbucket b-" + b}>
            <h3>
              {label} <span className="count">{l.length}</span>
            </h3>
            <div className="lrows">
              {l.map((t) => (
                <TaskRow key={t.id} it={t} showPath expandable={false} extra={<StatusPill status={t.status} />} />
              ))}
            </div>
          </section>
        );
      })}
      {!tasks.length && <Empty>Nothing here.</Empty>}
    </div>
  );
}

/* =============================== PRIORITIES =============================== */
export function Priorities() {
  const { db, create, patch, remove } = useDB();
  const { openItem, setPage } = useApp();
  const items = db.item;
  const idx = useMemo(() => childrenIndex(items), [items]);
  const pr = Object.values(db.priority).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const streams = Object.values(items).filter((i) => i.kind === "stream" && !isClosed(items, i));
  const unlinked = streams.filter((s) => !(s.priority_ids || []).some((p) => db.priority[p]));
  const [linking, setLinking] = useState(null);
  const today = todayISO();

  const stats = (sid) => {
    const ts = descendants(items, sid, idx).filter((d) => d.kind === "task");
    const done = ts.filter((t) => t.status === "complete").length;
    const open = ts.filter((t) => !isClosed(items, t));
    const over = open.filter((t) => t.due && t.due < today).length;
    const next = open.filter((t) => t.due && t.due >= today).sort((a, b) => a.due.localeCompare(b.due))[0];
    const owners = [...new Set(open.flatMap((t) => t.owners || []))];
    return { total: ts.length, done, open: open.length, over, next, owners };
  };

  return (
    <div className="page priorities">
      <div className="toolbar">
        <p className="muted small">The big things we're trying to achieve, and the workstreams that serve each one. Click a workstream to edit it, or open it in the Planner.</p>
        <button className="btn primary toolbar-r" onClick={() => create("priority", { title: "New priority", emoji: "⭐", description: "", focus: false, sort: pr.length })}>
          + Priority
        </button>
      </div>
      <div className="prio-grid">
        {pr.map((p, i) => {
          const linked = streams.filter((s) => (s.priority_ids || []).includes(p.id));
          const agg = linked.map((s) => stats(s.id)).reduce((a, b) => ({ total: a.total + b.total, done: a.done + b.done, open: a.open + b.open, over: a.over + b.over }), { total: 0, done: 0, open: 0, over: 0 });
          return (
            <div key={p.id} className={"prio" + (p.focus ? " focus" : "")}>
              <div className="prio-h">
                <InlineInput className="emoji-in" value={p.emoji} onCommit={(v) => patch("priority", p.id, { emoji: v.trim() })} />
                <InlineInput className="prio-t" value={p.title} onCommit={(v) => patch("priority", p.id, { title: v })} />
                <button className={"star" + (p.focus ? " on" : "")} title={p.focus ? "Top focus" : "Mark as top focus"} onClick={() => patch("priority", p.id, { focus: !p.focus })}>
                  ★
                </button>
              </div>
              <AutoText className="prio-d" minRows={1} value={p.description} onChange={(v) => patch("priority", p.id, { description: v })} placeholder="Why this matters / what success looks like" />
              <div className="prio-bar" title={`${agg.done} of ${agg.total} items complete`}>
                <div style={{ width: agg.total ? (100 * agg.done) / agg.total + "%" : 0 }} />
              </div>
              <div className="prio-sum muted small">
                {agg.open} open · {agg.done} done{agg.over ? <span className="over"> · {agg.over} overdue</span> : null}
              </div>
              <div className="prio-streams">
                {linked.map((s) => {
                  const st = stats(s.id);
                  const area = items[s.parent_id];
                  return (
                    <div key={s.id} className="ps" onClick={() => openItem(s.id)}>
                      <div className="ps-t">
                        <span>
                          {s.emoji} {s.title}
                        </span>
                        <span className="muted small">{area ? `${area.emoji || ""} ${area.title}` : ""}</span>
                      </div>
                      <div className="ps-m">
                        <span>{st.open} open</span>
                        {st.over > 0 && <span className="over">{st.over} overdue</span>}
                        {st.next && (
                          <span>
                            next: {fmtDate(st.next.due)} · {st.next.title.slice(0, 40)}
                            {st.next.title.length > 40 ? "…" : ""}
                          </span>
                        )}
                        <OwnerChips ids={st.owners} max={5} />
                      </div>
                    </div>
                  );
                })}
                {!linked.length && <div className="muted small">No workstreams linked yet.</div>}
              </div>
              <div className="prio-f">
                <button className="link small" onClick={() => setLinking(p.id)}>
                  Link workstreams
                </button>
                <span className="grow-r" />
                <button className="link small" disabled={i === 0} onClick={() => patch("priority", p.id, { sort: (pr[i - 1].sort ?? 0) - 0.5 })}>
                  ↑
                </button>
                <button className="link small" disabled={i === pr.length - 1} onClick={() => patch("priority", p.id, { sort: (pr[i + 1].sort ?? 0) + 0.5 })}>
                  ↓
                </button>
                <button className="link small danger" onClick={() => confirm(`Delete priority “${p.title}”? Workstreams are kept.`) && remove("priority", p.id)}>
                  Delete
                </button>
              </div>
              {linking === p.id && <LinkStreams p={p} onClose={() => setLinking(null)} />}
            </div>
          );
        })}
      </div>
      {unlinked.length > 0 && (
        <div className="unlinked">
          <h4>Workstreams not linked to any priority</h4>
          <div className="chips">
            {unlinked.map((s) => (
              <button key={s.id} className="chip" onClick={() => openItem(s.id)}>
                {s.emoji} {s.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LinkStreams({ p, onClose }) {
  const { db, patch } = useDB();
  const items = db.item;
  const idx = childrenIndex(items);
  const areas = (idx[""] || []).filter((a) => a.kind === "area");
  return (
    <div className="linkbox">
      {areas.map((a) => (
        <div key={a.id}>
          <div className="muted small">
            {a.emoji} {a.title}
          </div>
          {(idx[a.id] || [])
            .filter((s) => s.kind === "stream")
            .map((s) => {
              const on = (s.priority_ids || []).includes(p.id);
              return (
                <label key={s.id} className="pop-row">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => patch("item", s.id, { priority_ids: on ? s.priority_ids.filter((x) => x !== p.id) : [...(s.priority_ids || []), p.id] })}
                  />
                  {s.emoji} {s.title}
                </label>
              );
            })}
        </div>
      ))}
      <button className="btn ghost small" onClick={onClose}>
        Done
      </button>
    </div>
  );
}

/* =============================== SOMEDAY =============================== */
export function Someday() {
  const { db, create, updateItem } = useDB();
  const { openItem } = useApp();
  const items = db.item;
  const idx = useMemo(() => childrenIndex(items), [items]);
  const parked = Object.values(items).filter((i) => i.kind === "task" && i.status === "someday" && !isClosed(items, i));
  // only top-most parked items (a parked sub-item under a parked item shows inside it)
  const tops = parked.filter((i) => !ancestorsParked(items, i));
  const streams = Object.values(items).filter((i) => i.kind === "stream" && !isClosed(items, i));
  const order = new Map();
  let n = 0;
  const walk = (pid) => (idx[pid] || []).forEach((c) => (order.set(c.id, n++), walk(c.id)));
  walk("");
  const groups = new Map();
  for (const t of tops) {
    const anc = [...pathOf(items, t)];
    const s = anc.reverse().find((a) => a.kind === "stream" || a.kind === "area");
    const k = s ? s.id : "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const [text, setText] = useState("");
  const [where, setWhere] = useState(() => {
    try {
      return localStorage.getItem("wb-someday-where") || "";
    } catch (e) {
      return "";
    }
  });
  const target = items[where] && items[where].kind === "stream" ? where : streams.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))[0]?.id;
  const add = () => {
    const t = text.trim();
    if (!t || !target) return;
    create("item", { kind: "task", parent_id: target, title: t, status: "someday", owners: [], start: todayISO(), due: null, blocked_by: [], sort: Date.now() });
    setText("");
  };
  const label = (id) => {
    const s = items[id];
    if (!s) return "Other";
    const a = s.kind === "stream" ? items[s.parent_id] : null;
    return (a ? (a.emoji ? a.emoji + " " : "") + a.title + " › " : "") + (s.emoji ? s.emoji + " " : "") + s.title;
  };
  return (
    <div className="page someday">
      <div className="toolbar">
        <p className="muted small">Big ideas and items we've parked for later. Nothing here shows on the Planner, People, Deadlines or Gantt until you bring it back.</p>
      </div>
      <div className="someday-add">
        <input placeholder="Park a new idea… (press Enter)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <select
          value={target || ""}
          onChange={(e) => {
            setWhere(e.target.value);
            try {
              localStorage.setItem("wb-someday-where", e.target.value);
            } catch (er) {}
          }}
          title="Which workstream it belongs to"
        >
          {streams
            .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {label(s.id)}
              </option>
            ))}
        </select>
      </div>
      {[...groups.entries()]
        .sort((a, b) => (order.get(a[0]) ?? 1e9) - (order.get(b[0]) ?? 1e9))
        .map(([k, l]) => (
          <section key={k} className="lbucket">
            <h3>
              {label(k)} <span className="count">{l.length}</span>
            </h3>
            <div className="lrows">
              {l.map((t) => (
                <TaskRow
                  key={t.id}
                  it={t}
                  extra={
                    <button
                      className="link small"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateItem(t.id, { status: "planning", start: todayISO() });
                      }}
                    >
                      ↩ Bring back (To plan)
                    </button>
                  }
                />
              ))}
            </div>
          </section>
        ))}
      {!tops.length && <Empty>Nothing parked. Set any item's status to Someday to move it here.</Empty>}
    </div>
  );
}
const pathOf = (items, it) => {
  const out = [];
  let cur = items[it.parent_id];
  let g = 0;
  while (cur && g++ < 50) {
    out.unshift(cur);
    cur = items[cur.parent_id];
  }
  return out;
};
const ancestorsParked = (items, it) => pathOf(items, it).some((a) => a.kind === "task" && a.status === "someday");

/* =============================== COMPLETED =============================== */
export function Completed() {
  const { db, updateItem, deleteItem } = useDB();
  const { openItem } = useApp();
  const items = db.item;
  const [q, setQ] = useState("");
  const done = Object.values(items)
    .filter((i) => i.status === "complete")
    .filter((i) => (i.title + " " + pathLabel(items, i.id)).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""));
  const groups = {};
  done.forEach((i) => {
    const k = i.completed_at ? monthLabel(i.completed_at.slice(0, 10)) : "Earlier";
    (groups[k] = groups[k] || []).push(i);
  });
  return (
    <div className="page completed">
      <div className="toolbar">
        <input className="search" placeholder="Search completed…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small toolbar-r">{done.length} completed</span>
      </div>
      {Object.entries(groups).map(([k, l]) => (
        <section key={k} className="lbucket">
          <h3>
            {k} <span className="count">{l.length}</span>
          </h3>
          <div className="lrows">
            {l.map((i) => (
              <div key={i.id} className="task is-done" onClick={() => openItem(i.id)}>
                <span className="check done">✓</span>
                <div className="task-main">
                  <div className="task-title">
                    {i.emoji ? i.emoji + " " : ""}
                    {i.title}
                  </div>
                  <div className="task-path">{pathLabel(items, i.id)}</div>
                  <div className="task-meta">
                    <OwnerChips ids={i.owners} />
                    {i.completed_at && <span className="muted small">done {fmtDate(i.completed_at.slice(0, 10))}</span>}
                    <button
                      className="link small"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateItem(i.id, { status: "standup" });
                      }}
                    >
                      Restore
                    </button>
                    <button
                      className="link small danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteItem(i.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {!done.length && <Empty>Nothing completed yet. Tick the circle on any item to complete it — it moves here.</Empty>}
    </div>
  );
}

/* =============================== MEETINGS =============================== */
export function Meetings() {
  const { db, create, patch, remove } = useDB();
  const [q, setQ] = useState("");
  const [who, setWho] = useState("");
  const all = Object.values(db.meeting).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const list = all.filter((m) => (!who || (m.person_ids || []).includes(who)) && (m.title + " " + (m.body || "")).toLowerCase().includes(q.toLowerCase()));
  const [sel, setSel] = useState(null);
  const cur = db.meeting[sel] || null;
  useEffect(() => {
    if (!cur && list[0]) setSel(list[0].id);
    // eslint-disable-next-line
  }, [list.length]);
  const people = Object.values(db.person).filter((p) => all.some((m) => (m.person_ids || []).includes(p.id)));
  return (
    <div className="page meetings split">
      <div className="split-l">
        <div className="split-tools">
          <button className="btn primary" onClick={() => setSel(create("meeting", { title: "New meeting", date: todayISO(), person_ids: [], body: "" }).id)}>
            + Meeting notes
          </button>
          <input className="search" placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="mlist">
          {list.map((m) => (
            <button key={m.id} className={"mrow" + (sel === m.id ? " on" : "")} onClick={() => setSel(m.id)}>
              <span className="mdate">{fmtDate(m.date)}</span>
              <span className="mtitle">{m.title}</span>
              <OwnerChips ids={m.person_ids} max={3} />
            </button>
          ))}
          {!list.length && <div className="muted small pad">No meeting notes.</div>}
        </div>
      </div>
      <div className="split-r">
        {cur ? (
          <div className="mnote">
            <InlineInput className="mnote-t" value={cur.title} onCommit={(v) => patch("meeting", cur.id, { title: v })} />
            <div className="mnote-m">
              <input type="date" value={cur.date || ""} onChange={(e) => patch("meeting", cur.id, { date: e.target.value })} />
              <PeoplePicker label="Who was there" value={cur.person_ids || []} onChange={(v) => patch("meeting", cur.id, { person_ids: v })} />
              <button className="link small danger grow-r" onClick={() => confirm("Delete these notes?") && (remove("meeting", cur.id), setSel(null))}>
                Delete
              </button>
            </div>
            <AutoText className="mnote-b" minRows={18} value={cur.body} onChange={(v) => patch("meeting", cur.id, { body: v })} placeholder="Notes… (these are a record, not action items — put actions in the Planner)" />
          </div>
        ) : (
          <Empty>Pick a meeting or start new notes.</Empty>
        )}
      </div>
    </div>
  );
}

/* =============================== MENTORSHIP =============================== */
export function Mentorship({ personId }) {
  const { db, create, patch, remove, setToast, put } = useDB();
  const people = Object.values(db.person)
    .filter((p) => !p.archived)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const notes = Object.values(db.mentor);
  const [pid, setPid] = useState(personId || (people.find((p) => notes.some((n) => n.person_id === p.id)) || people[0])?.id);
  useEffect(() => {
    if (personId) setPid(personId);
  }, [personId]);
  const [copied, setCopied] = useState(false);
  const mine = notes.filter((n) => n.person_id === pid).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  const person = db.person[pid];
  const del = (n) => {
    remove("mentor", n.id);
    setToast({ id: n.id, text: "Note removed", undo: () => put("mentor", n) });
  };
  const COLS = [
    ["keep", "🧠 Keep in mind", "Background, patterns, things to watch"],
    ["share", "💬 Share at next meeting", "Feedback and points to raise — remove once discussed"],
  ];
  return (
    <div className="page mentorship">
      <div className="subnav">
        {people.map((p) => {
          const c = notes.filter((n) => n.person_id === p.id).length;
          return (
            <button key={p.id} className={"subtab" + (pid === p.id ? " on" : "")} onClick={() => setPid(p.id)}>
              <Avatar person={p} size={18} /> {p.short || p.name} {c > 0 && <span className="count">{c}</span>}
            </button>
          );
        })}
      </div>
      {person && (
        <div className="mentor-cols">
          {COLS.map(([k, label, hint]) => {
            const l = mine.filter((n) => n.kind === k);
            return (
              <div key={k} className={"mcol " + k}>
                <div className="mcol-h">
                  <h3>{label}</h3>
                  <span className="muted small">{hint}</span>
                  {k === "share" && l.length > 0 && (
                    <button
                      className="link small"
                      onClick={() =>
                        copyText(`For ${person.name}:\n` + l.map((n) => "• " + n.text).join("\n")).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))
                      }
                    >
                      {copied ? "Copied ✓" : "Copy list"}
                    </button>
                  )}
                </div>
                {l.map((n) => (
                  <div key={n.id} className="mnote-row">
                    <AutoText minRows={1} value={n.text} onChange={(v) => patch("mentor", n.id, { text: v })} />
                    <div className="mnote-a">
                      <span className="muted small">{fmtDate((n.created_at || "").slice(0, 10))}</span>
                      <button className="link small" onClick={() => patch("mentor", n.id, { kind: k === "keep" ? "share" : "keep" })}>
                        {k === "keep" ? "→ raise next time" : "← keep in mind"}
                      </button>
                      <button className="link small" onClick={() => del(n)} title={k === "share" ? "Discussed — remove" : "Remove"}>
                        {k === "share" ? "✓ Discussed" : "Remove"}
                      </button>
                    </div>
                  </div>
                ))}
                <AddNote onAdd={(text) => create("mentor", { person_id: pid, kind: k, text })} />
              </div>
            );
          })}
        </div>
      )}
      {!people.length && <Empty>Add people first (People → Manage people).</Empty>}
    </div>
  );
}
function AddNote({ onAdd }) {
  const [v, setV] = useState("");
  return (
    <input
      className="add-input"
      placeholder="+ Add a note (Enter)"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && v.trim()) {
          onAdd(v.trim());
          setV("");
        }
      }}
    />
  );
}
