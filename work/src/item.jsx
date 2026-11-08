import { createContext, useContext, useMemo, useState } from "react";
import { useDB } from "./db.js";
import {
  todayISO, fmtDate, pathLabel, childrenIndex, openBlockers, wouldCycle, dependentsIndex, isClosed, canStartNow, requiredStart, ancestors, STATUS,
} from "./logic.js";
import { OwnerChips, DueChip, PeoplePicker, StatusSelect, AutoText, InlineInput, CheckCircle, Popover, StatusPill } from "./ui.jsx";

export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

/* ---------------- one task row, used on every page ---------------- */
export function TaskRow({ it, showPath, depth = 0, expandable = true, draggable, onDragStart, extra }) {
  const { db, updateItem } = useDB();
  const { openItem } = useApp();
  const items = db.item;
  const [open, setOpen] = useState(false);
  const idx = useMemo(() => (expandable ? childrenIndex(items) : {}), [items, expandable]);
  const kids = (idx[it.id] || []).filter((k) => k.status !== "complete");
  const blockers = openBlockers(items, it);
  const done = it.status === "complete";
  const ready = canStartNow(items, it);
  const late = it.start && requiredStart(items, it) && it.start < requiredStart(items, it);
  return (
    <>
      <div
        className={"task" + (done ? " is-done" : "") + (it.private ? " is-private" : "")}
        style={{ paddingLeft: 8 + depth * 18 }}
        onClick={() => openItem(it.id)}
        draggable={draggable}
        onDragStart={onDragStart}
      >
        <CheckCircle done={done} onClick={() => updateItem(it.id, { status: done ? "standup" : "complete" })} />
        <div className="task-main">
          <div className="task-title">
            {kids.length > 0 && (
              <button
                className={"twisty" + (open ? " open" : "")}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(!open);
                }}
                title={open ? "Hide sub-items" : "Show sub-items"}
              >
                ▸
              </button>
            )}
            <span>{it.title}</span>
            {kids.length > 0 && <span className="kidcount">{kids.length}</span>}
          </div>
          {showPath && <div className="task-path">{pathLabel(items, it.id)}</div>}
          <div className="task-meta">
            <OwnerChips ids={it.owners} />
            <DueChip due={it.due} done={done} />
            {blockers.length > 0 && (
              <span className="waiting" title={"Waiting on: " + blockers.map((b) => b.title).join("; ")}>
                ⏳ {blockers.length === 1 ? blockers[0].title.slice(0, 34) + (blockers[0].title.length > 34 ? "…" : "") : `${blockers.length} blockers`}
              </span>
            )}
            {ready && <span className="ready">✓ can start now</span>}
            {late && <span className="warn" title="Starts before its blocker is due">⚠ starts before blocker</span>}
            {it.private && <span className="lock" title="Private — never shared">🔒</span>}
            {extra}
          </div>
        </div>
      </div>
      {open && kids.map((k) => <TaskRow key={k.id} it={k} depth={depth + 1} showPath={false} />)}
    </>
  );
}

/* ---------------- search picker for blockers / parents ---------------- */
function ItemSearch({ exclude = () => false, onPick, placeholder, onClose, kinds = ["task"] }) {
  const { db } = useDB();
  const [q, setQ] = useState("");
  const items = db.item;
  const list = Object.values(items)
    .filter((i) => kinds.includes(i.kind) && !isClosed(items, i) && !exclude(i))
    .filter((i) => (i.title + " " + pathLabel(items, i.id)).toLowerCase().includes(q.toLowerCase()))
    .slice(0, 40);
  return (
    <Popover open onClose={onClose} className="wide-pop">
      <input autoFocus className="pop-search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="pop-list">
        {list.map((i) => (
          <button key={i.id} className="pop-row col" onClick={() => onPick(i.id)}>
            <span>
              {i.emoji ? i.emoji + " " : ""}
              {i.title}
            </span>
            <span className="muted small">{pathLabel(items, i.id) || "Top level"}</span>
          </button>
        ))}
        {!list.length && <div className="muted small pad">Nothing matches</div>}
      </div>
    </Popover>
  );
}

/* ---------------- the edit panel ---------------- */
export function ItemPanel({ id, onClose }) {
  const { db, updateItem, addBlocker, deleteItem, create, patch } = useDB();
  const { openItem } = useApp();
  const items = db.item;
  const it = items[id];
  const [picking, setPicking] = useState(null); // 'blocker' | 'move'
  const [newSub, setNewSub] = useState("");
  if (!it) return null;
  const idx = childrenIndex(items);
  const kids = idx[it.id] || [];
  const deps = (dependentsIndex(items)[it.id] || []).map((d) => items[d]).filter(Boolean);
  const isTask = it.kind === "task";
  const up = (p) => updateItem(it.id, p);
  const req = requiredStart(items, it);

  const addSub = () => {
    const t = newSub.trim();
    if (!t) return;
    create("item", { kind: "task", parent_id: it.id, title: t, owners: it.owners || [], status: "planning", start: todayISO(), due: null, sort: kids.length, blocked_by: [] });
    setNewSub("");
  };

  return (
    <aside className="panel" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="panel-h">
        <div className="crumbs">
          {ancestors(items, it.id).map((a) => (
            <button key={a.id} onClick={() => openItem(a.id)}>
              {a.emoji ? a.emoji + " " : ""}
              {a.title}
            </button>
          ))}
          {!it.parent_id && <span className="muted">Top level</span>}
        </div>
        <button className="x" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="panel-b">
        <div className="title-row">
          {!isTask && <InlineInput className="emoji-in" value={it.emoji} onCommit={(v) => up({ emoji: v.trim() })} placeholder="🙂" />}
          <AutoText className="title-in" minRows={1} value={it.title} onChange={(v) => up({ title: v.replace(/\n/g, " ") })} />
        </div>
        <div className="kind-tag">{it.kind === "area" ? "Area" : it.kind === "stream" ? "Workstream" : ancestors(items, it.id).some((a) => a.kind === "task") ? "Sub-item" : "Item"}</div>

        {isTask && (
          <>
            <Field label="Status">
              <StatusSelect value={it.status} onChange={(s) => up({ status: s })} />
            </Field>
            <Field label="Owners">
              <PeoplePicker value={it.owners || []} onChange={(o) => up({ owners: o })} />
            </Field>
            <div className="two">
              <Field label="Start">
                <input type="date" value={it.start || ""} onChange={(e) => up({ start: e.target.value || null })} />
              </Field>
              <Field label="Deadline">
                <div className="date-wrap">
                  <input type="date" value={it.due || ""} onChange={(e) => up({ due: e.target.value || null })} />
                  {it.due && (
                    <button className="mini" onClick={() => up({ due: null })} title="Clear deadline">
                      ×
                    </button>
                  )}
                </div>
              </Field>
            </div>
            {req && it.start && it.start < req && (
              <div className="note warn">
                This starts before what it is waiting on is due.{" "}
                <button className="link" onClick={() => up({ start: req })}>
                  Move start to {fmtDate(req)}
                </button>
              </div>
            )}
            {canStartNow(items, it) && (
              <div className="note ok">
                Everything it was waiting on is done — it could start now.{" "}
                <button className="link" onClick={() => up({ start: todayISO() })}>
                  Start today
                </button>
              </div>
            )}

            <Field label="Waiting on" hint="If any of these slip, this item gets pushed back.">
              <div className="links">
                {(it.blocked_by || []).map((b) => {
                  const bi = items[b];
                  if (!bi) return null;
                  const closed = isClosed(items, bi);
                  return (
                    <div key={b} className={"clip" + (closed ? " closed" : "")}>
                      <span className="clip-ico">📎</span>
                      <button className="clip-title" onClick={() => openItem(b)}>
                        {bi.title}
                      </button>
                      <OwnerChips ids={bi.owners} max={2} />
                      {closed ? <span className="pill st-complete">Done</span> : <DueChip due={bi.due} />}
                      <button className="mini" title="Remove" onClick={() => up({ blocked_by: it.blocked_by.filter((x) => x !== b) })}>
                        ×
                      </button>
                    </div>
                  );
                })}
                <div className="rel">
                  <button className="add-link" onClick={() => setPicking("blocker")}>
                    + Clip to something it waits on
                  </button>
                  {picking === "blocker" && (
                    <ItemSearch
                      placeholder="What does this wait on?"
                      exclude={(i) => i.id === it.id || (it.blocked_by || []).includes(i.id) || wouldCycle(items, it.id, i.id)}
                      onPick={(b) => {
                        addBlocker(it.id, b);
                        setPicking(null);
                      }}
                      onClose={() => setPicking(null)}
                    />
                  )}
                </div>
              </div>
            </Field>
            {deps.length > 0 && (
              <Field label="Holding up">
                <div className="links">
                  {deps.map((d) => (
                    <div key={d.id} className="clip">
                      <span className="clip-ico">⛓</span>
                      <button className="clip-title" onClick={() => openItem(d.id)}>
                        {d.title}
                      </button>
                      <OwnerChips ids={d.owners} max={2} />
                      <span className="muted small">starts {fmtDate(d.start)}</span>
                    </div>
                  ))}
                </div>
              </Field>
            )}
          </>
        )}

        {it.kind === "stream" && <PriorityLinks it={it} />}

        <Field label={isTask ? "Shared description" : "Description"} hint={isTask ? "Shows on shared lists and live links." : null}>
          <AutoText value={it.description} onChange={(v) => up({ description: v })} placeholder="What does done look like?" />
        </Field>
        <Field label="🔒 Internal notes" hint="Only you and Justin ever see these.">
          <AutoText className="internal" value={it.notes} onChange={(v) => up({ notes: v })} placeholder="Context, thoughts, history…" />
        </Field>

        <label className="toggle">
          <input type="checkbox" checked={!!it.private} onChange={(e) => up({ private: e.target.checked })} />
          <span>
            <b>Private</b> — never appears on shared lists or live links{it.kind !== "task" ? " (nor does anything inside it)" : ""}
          </span>
        </label>

        <Field label={isTask ? "Sub-items" : "Inside"}>
          <div className="subs">
            {kids
              .filter((k) => k.status !== "complete")
              .map((k) => (
                <TaskRow key={k.id} it={k} expandable={false} />
              ))}
            {isTask && (
              <input
                className="add-input"
                placeholder="+ Add a sub-item"
                value={newSub}
                onChange={(e) => setNewSub(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addSub()}
              />
            )}
            {kids.some((k) => k.status === "complete") && <div className="muted small">{kids.filter((k) => k.status === "complete").length} completed (see Completed)</div>}
          </div>
        </Field>

        {(it.history || []).length > 0 && (
          <Field label="History">
            <div className="history">
              {[...it.history].reverse().map((h, i) => (
                <div key={i}>
                  <span className="muted">{fmtDate(h.at)}</span> {h.text}
                </div>
              ))}
            </div>
          </Field>
        )}

        <div className="panel-actions">
          <div className="rel">
            <button className="btn ghost" onClick={() => setPicking("move")}>
              Move…
            </button>
            {picking === "move" && (
              <ItemSearch
                kinds={it.kind === "task" ? ["area", "stream", "task"] : it.kind === "stream" ? ["area"] : []}
                placeholder="Move under…"
                exclude={(i) => i.id === it.id || ancestors(items, i.id).some((a) => a.id === it.id)}
                onPick={(p) => {
                  patch("item", it.id, { parent_id: p, sort: Date.now() });
                  setPicking(null);
                }}
                onClose={() => setPicking(null)}
              />
            )}
          </div>
          <button
            className="btn ghost danger"
            onClick={() => {
              const n = kids.length;
              if (n && !confirm(`Delete “${it.title}” and everything inside it?`)) return;
              deleteItem(it.id);
              onClose();
            }}
          >
            Delete
          </button>
          <span className="muted small grow-r">Created {fmtDate((it.created_at || "").slice(0, 10))}</span>
        </div>
      </div>
    </aside>
  );
}

function PriorityLinks({ it }) {
  const { db, patch } = useDB();
  const pr = Object.values(db.priority).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const ids = it.priority_ids || [];
  return (
    <Field label="Serves priorities">
      <div className="prio-tags">
        {pr.map((p) => (
          <button
            key={p.id}
            className={"tag" + (ids.includes(p.id) ? " on" : "")}
            onClick={() => patch("item", it.id, { priority_ids: ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id] })}
          >
            {p.emoji} {p.title}
          </button>
        ))}
        {!pr.length && <span className="muted small">No priorities yet — add them on the Priorities page.</span>}
      </div>
    </Field>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      <div className="field-l">
        {label}
        {hint && <span className="hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export { StatusPill };
