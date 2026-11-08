import { useMemo, useState } from "react";
import { useDB } from "../db.js";
import { openTasks, bucketOf, BUCKETS } from "../logic.js";
import { TaskRow, useApp } from "../item.jsx";
import { Avatar, Modal, PALETTE, Empty, InlineInput } from "../ui.jsx";

const sortPeople = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name);

export function People() {
  const { db } = useDB();
  const { setPage } = useApp();
  const people = Object.values(db.person).filter((p) => !p.archived).sort(sortPeople);
  const [managing, setManaging] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(true);
  const tasks = useMemo(() => openTasks(db.item), [db.item]);
  const byPerson = (pid) => tasks.filter((t) => (t.owners || []).includes(pid));
  const shown = people.filter((p) => !hideEmpty || byPerson(p.id).length);

  return (
    <div className="page people">
      <div className="toolbar">
        <p className="muted small">Everyone's open items, soonest deadline first.</p>
        <div className="toolbar-r">
          <label className="toggle small">
            <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Hide people with nothing open
          </label>
          <button className="btn ghost" onClick={() => setManaging(true)}>
            Add / edit people
          </button>
        </div>
      </div>
      <div className="person-grid">
        {shown.map((p) => {
          const list = byPerson(p.id);
          const over = list.filter((t) => bucketOf(t.due) === "overdue").length;
          return (
            <div key={p.id} className="person">
              <div className="person-h">
                <Avatar person={p} size={30} />
                <div className="person-n">
                  <b>{p.name}</b>
                  <span className="muted small">{p.role}</span>
                </div>
                <div className="person-c">
                  <span>{list.length} open</span>
                  {over > 0 && <span className="over">{over} overdue</span>}
                </div>
              </div>
              <div className="person-b">
                {BUCKETS.map(([b, label]) => {
                  const l = list.filter((t) => bucketOf(t.due) === b).sort((x, y) => (x.due || "").localeCompare(y.due || ""));
                  if (!l.length) return null;
                  return (
                    <div key={b} className={"bucket b-" + b}>
                      <div className="bucket-h">
                        {label} <span className="count">{l.length}</span>
                      </div>
                      {l.map((t) => (
                        <TaskRow key={t.id} it={t} showPath expandable={false} />
                      ))}
                    </div>
                  );
                })}
                {!list.length && <div className="muted small pad">Nothing open 🎉</div>}
                <button className="link small" onClick={() => setPage("mentorship", p.id)}>
                  Mentorship notes →
                </button>
              </div>
            </div>
          );
        })}
        {!shown.length && <Empty>No one has open items yet.</Empty>}
      </div>
      {managing && <ManagePeople onClose={() => setManaging(false)} />}
    </div>
  );
}

function ManagePeople({ onClose }) {
  const { db, create, patch } = useDB();
  const all = Object.values(db.person).sort(sortPeople);
  const [name, setName] = useState("");
  const add = () => {
    if (!name.trim()) return;
    create("person", { name: name.trim(), role: "", color: PALETTE[all.length % PALETTE.length], sort: all.length });
    setName("");
  };
  return (
    <Modal title="People" onClose={onClose} wide>
      <p className="muted small">Anyone can be given items — only you and Justin log in. Archive someone who has left: they disappear from lists but their history is kept.</p>
      <div className="mp-list">
        {all.map((p, i) => (
          <div key={p.id} className={"mp-row" + (p.archived ? " archived" : "")}>
            <input type="color" value={p.color || "#73705F"} onChange={(e) => patch("person", p.id, { color: e.target.value })} title="Colour" />
            <InlineInput value={p.name} onCommit={(v) => v.trim() && patch("person", p.id, { name: v.trim() })} />
            <InlineInput value={p.role} placeholder="Role" onCommit={(v) => patch("person", p.id, { role: v })} />
            <div className="mp-move">
              <button disabled={i === 0} onClick={() => patch("person", p.id, { sort: (all[i - 1].sort ?? i - 1) - 0.5 })} title="Move up">
                ↑
              </button>
              <button disabled={i === all.length - 1} onClick={() => patch("person", p.id, { sort: (all[i + 1].sort ?? i + 1) + 0.5 })} title="Move down">
                ↓
              </button>
            </div>
            <button className="link small" onClick={() => patch("person", p.id, { archived: !p.archived })}>
              {p.archived ? "Restore" : "Archive"}
            </button>
          </div>
        ))}
      </div>
      <div className="mp-add">
        <input placeholder="New person's name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn primary" onClick={add}>
          Add
        </button>
      </div>
    </Modal>
  );
}
