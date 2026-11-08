import { useMemo, useState } from "react";
import { useDB } from "../db.js";
import { openTasks, bucketOf, BUCKETS, shareItems, groupShare, shareText, token, fmtDate, todayISO } from "../logic.js";
import { TaskRow, useApp } from "../item.jsx";
import { Avatar, Modal, copyText, PALETTE, Empty, InlineInput } from "../ui.jsx";

const sortPeople = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name);

export function People() {
  const { db, create, remove, patch } = useDB();
  const { setPage } = useApp();
  const people = Object.values(db.person).filter((p) => !p.archived).sort(sortPeople);
  const groups = Object.values(db.group).sort((a, b) => a.name.localeCompare(b.name));
  const [sel, setSel] = useState([]);
  const [sharing, setSharing] = useState(null);
  const [managing, setManaging] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(true);
  const tasks = useMemo(() => openTasks(db.item), [db.item]);
  const byPerson = (pid) => tasks.filter((t) => (t.owners || []).includes(pid));
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const activeGroup = groups.find((g) => g.person_ids.length === sel.length && g.person_ids.every((p) => sel.includes(p)));
  const shownPeople = sel.length ? people.filter((p) => sel.includes(p.id)) : people.filter((p) => !hideEmpty || byPerson(p.id).length);

  return (
    <div className="page people">
      <div className="toolbar">
        <div className="chips">
          <button className={"chip" + (!sel.length ? " on" : "")} onClick={() => setSel([])}>
            Everyone
          </button>
          {groups.map((g) => (
            <span key={g.id} className={"chip group" + (activeGroup?.id === g.id ? " on" : "")}>
              <button onClick={() => setSel(g.person_ids.filter((p) => db.person[p]))}>👥 {g.name}</button>
              <button
                className="chip-x"
                title="Delete group"
                onClick={() => confirm(`Delete the group “${g.name}”? (People are not affected)`) && remove("group", g.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="toolbar-r">
          {sel.length > 0 && (
            <>
              <span className="muted small">{sel.length} selected</span>
              {!activeGroup && sel.length > 1 && (
                <button
                  className="btn ghost"
                  onClick={() => {
                    const n = prompt("Name this group:", "");
                    if (n) create("group", { name: n, person_ids: sel });
                  }}
                >
                  Save as group
                </button>
              )}
              <button className="btn primary" onClick={() => setSharing({ ids: sel, label: activeGroup?.name || sel.map((s) => db.person[s]?.name).join(", ") })}>
                Share…
              </button>
            </>
          )}
          {!sel.length && (
            <label className="toggle small">
              <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Hide people with nothing open
            </label>
          )}
          <button className="btn ghost" onClick={() => setManaging(true)}>
            Manage people
          </button>
        </div>
      </div>
      <p className="muted small hint-line">Tick people to select them, then Share to copy, print or make a live link — for one person or several together.</p>
      <div className="person-grid">
        {shownPeople.map((p) => {
          const list = byPerson(p.id);
          const over = list.filter((t) => bucketOf(t.due) === "overdue").length;
          return (
            <div key={p.id} className={"person" + (sel.includes(p.id) ? " sel" : "")}>
              <div className="person-h">
                <input type="checkbox" checked={sel.includes(p.id)} onChange={() => toggle(p.id)} title="Select" />
                <Avatar person={p} size={30} />
                <div className="person-n">
                  <b>{p.name}</b>
                  <span className="muted small">{p.role}</span>
                </div>
                <div className="person-c">
                  <span>{list.length} open</span>
                  {over > 0 && <span className="over">{over} overdue</span>}
                </div>
                <button className="btn ghost small" onClick={() => setSharing({ ids: [p.id], label: p.name })}>
                  Share
                </button>
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
        {!shownPeople.length && <Empty>No one has open items. Add people with “Manage people”.</Empty>}
      </div>
      <LiveLinks />
      {sharing && <ShareModal ids={sharing.ids} label={sharing.label} onClose={() => setSharing(null)} />}
      {managing && <ManagePeople onClose={() => setManaging(false)} />}
    </div>
  );
}

/* ---------------- share: copy / print / live link ---------------- */
export const shareUrl = (t) => {
  const base = location.href.split(/[?#]/)[0].replace(/index\.html$/, "").replace(/\/?$/, "/");
  return `${base}share.html?t=${t}${new URLSearchParams(location.search).has("demo") ? "&demo" : ""}`;
};

export function ShareModal({ ids, label, onClose }) {
  const { db, create, patch } = useDB();
  const [layout, setLayout] = useState(ids.length > 1 ? "stream" : "person");
  const [copied, setCopied] = useState("");
  const list = shareItems(db.item, db.person, ids);
  const groups = groupShare(list, db.person, ids, layout);
  const text = shareText({ label, groups, layout });
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  const link = Object.values(db.share).find((s) => !s.revoked && sameSet(s.person_ids || [], ids));
  const flash = (k) => (setCopied(k), setTimeout(() => setCopied(""), 1600));

  const print = () => {
    const w = window.open("", "_blank");
    const esc = (s) => String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(label)} — open items</title>
      <style>body{font:13px/1.45 system-ui,sans-serif;margin:32px;color:#26251F}h1{font-size:20px;margin:0 0 2px}h2{font-size:14px;margin:22px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
      .it{margin:0 0 9px 0;padding-left:14px;position:relative}.it:before{content:"☐";position:absolute;left:-2px}.t{font-weight:600}.m{color:#666;font-size:12px}.d{white-space:pre-wrap;color:#333;font-size:12px}.w{color:#9a6a12;font-size:12px}.o{color:#B0544A}</style>
      <h1>${esc(label)} — open items</h1><div class="m">${fmtDate(todayISO(), { dow: true })}</div>
      ${groups
        .filter((g) => g.items.length)
        .map(
          (g) => `<h2>${esc(g.title)}</h2>${g.items
            .map(
              (it) => `<div class="it"><div class="t">${esc(it.title)}</div><div class="m">${layout === "stream" ? esc(it.owners.join(", ")) + " · " : esc(it.path.join(" › ")) + " · "}${
                it.due ? `<span class="${it.due < todayISO() ? "o" : ""}">due ${fmtDate(it.due)}</span>` : "no deadline"
              }</div>${it.description ? `<div class="d">${esc(it.description)}</div>` : ""}${it.blockers
                .filter((b) => !b.done)
                .map((b) => `<div class="w">⏳ Waiting on: ${esc(b.title)}${b.owners.length ? " (" + esc(b.owners.join(", ")) + ")" : ""}${b.due ? ", due " + fmtDate(b.due) : ""}</div>`)
                .join("")}</div>`
            )
            .join("")}`
        )
        .join("")}`);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };

  return (
    <Modal title={`Share — ${label}`} onClose={onClose} wide>
      <div className="share-opts">
        <div className="seg">
          <button className={"seg-b" + (layout === "person" ? " on" : "")} onClick={() => setLayout("person")}>
            By person
          </button>
          <button className={"seg-b" + (layout === "stream" ? " on" : "")} onClick={() => setLayout("stream")}>
            By workstream
          </button>
        </div>
        <span className="muted small">
          {list.length} open item{list.length === 1 ? "" : "s"} · internal notes and 🔒 private items are never included
        </span>
      </div>
      <pre className="share-preview">{text || "Nothing open to share."}</pre>
      <div className="share-actions">
        <button className="btn primary" onClick={() => copyText(text).then(() => flash("text"))}>
          {copied === "text" ? "Copied ✓" : "Copy for WhatsApp / Slack"}
        </button>
        <button className="btn ghost" onClick={print}>
          Print / PDF
        </button>
      </div>
      <div className="live">
        <h4>Live link</h4>
        <p className="muted small">Always shows their current open items. Read-only, no password. Reset it any time to kill the old link.</p>
        {link ? (
          <div className="live-row">
            <input readOnly value={shareUrl(link.id)} onFocus={(e) => e.target.select()} />
            <button className="btn ghost" onClick={() => copyText(shareUrl(link.id)).then(() => flash("link"))}>
              {copied === "link" ? "Copied ✓" : "Copy"}
            </button>
            <a className="btn ghost" href={shareUrl(link.id)} target="_blank" rel="noreferrer">
              Open
            </a>
            <select value={link.layout || "person"} onChange={(e) => patch("share", link.id, { layout: e.target.value })} title="How the live page groups items">
              <option value="person">By person</option>
              <option value="stream">By workstream</option>
            </select>
            <button
              className="btn ghost danger"
              onClick={() => {
                if (!confirm("Reset this link? The old one stops working immediately.")) return;
                patch("share", link.id, { revoked: true });
                create("share", { id: token(), label, person_ids: ids, layout: link.layout || layout });
              }}
            >
              Reset
            </button>
            <button className="btn ghost danger" onClick={() => confirm("Turn off this live link?") && patch("share", link.id, { revoked: true })}>
              Turn off
            </button>
          </div>
        ) : (
          <button className="btn ghost" onClick={() => create("share", { id: token(), label, person_ids: ids, layout })}>
            Create live link
          </button>
        )}
      </div>
    </Modal>
  );
}

function LiveLinks() {
  const { db, patch } = useDB();
  const links = Object.values(db.share).filter((s) => !s.revoked);
  const [copied, setCopied] = useState("");
  if (!links.length) return null;
  return (
    <div className="livelinks">
      <h4>Live links in use</h4>
      {links.map((l) => (
        <div key={l.id} className="ll-row">
          <b>{l.label}</b>
          <span className="muted small">
            {(l.person_ids || []).map((p) => db.person[p]?.name).join(", ")} · made {fmtDate((l.created_at || "").slice(0, 10))}
          </span>
          <button className="link small" onClick={() => copyText(shareUrl(l.id)).then(() => (setCopied(l.id), setTimeout(() => setCopied(""), 1500)))}>
            {copied === l.id ? "Copied ✓" : "Copy link"}
          </button>
          <button className="link small danger" onClick={() => confirm(`Turn off ${l.label}'s live link?`) && patch("share", l.id, { revoked: true })}>
            Turn off
          </button>
        </div>
      ))}
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
      <p className="muted small">Anyone can own items. Only you and Justin ever log in. Archiving hides someone from pickers but keeps their history.</p>
      <div className="mp-list">
        {all.map((p, i) => (
          <div key={p.id} className={"mp-row" + (p.archived ? " archived" : "")}>
            <input type="color" value={p.color || "#73705F"} onChange={(e) => patch("person", p.id, { color: e.target.value })} title="Colour" />
            <InlineInput value={p.name} onCommit={(v) => v.trim() && patch("person", p.id, { name: v.trim() })} />
            <InlineInput value={p.role} placeholder="Role" onCommit={(v) => patch("person", p.id, { role: v })} />
            <div className="mp-move">
              <button disabled={i === 0} onClick={() => (patch("person", p.id, { sort: (all[i - 1].sort ?? i - 1) - 0.5 }))}>
                ↑
              </button>
              <button disabled={i === all.length - 1} onClick={() => patch("person", p.id, { sort: (all[i + 1].sort ?? i + 1) + 0.5 })}>
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
