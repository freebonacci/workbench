import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { useDB } from "./db.js";
import { fmtDate, todayISO, diffDays, STATUSES, STATUS } from "./logic.js";

export const PALETTE = ["#1E6B5A", "#C0892B", "#B0544A", "#4A6FA5", "#7A5BA6", "#3C8C8C", "#9A6B3F", "#5E7D32", "#B2557F", "#5A6577"];

export const initials = (name = "") =>
  name
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

export function Avatar({ person, size = 22, title }) {
  if (!person) return null;
  return (
    <span className="avatar" title={title || person.name} style={{ width: size, height: size, fontSize: size * 0.42, background: person.color || "#73705F" }}>
      {initials(person.name)}
    </span>
  );
}

export function OwnerChips({ ids = [], max = 4, names = false }) {
  const { db } = useDB();
  const ps = ids.map((id) => db.person[id]).filter(Boolean);
  if (!ps.length) return <span className="owner-none">No owner</span>;
  if (names)
    return (
      <span className="owner-names">
        {ps.map((p) => (
          <span key={p.id} className="owner-name">
            <Avatar person={p} size={18} />
            {p.short || p.name}
          </span>
        ))}
      </span>
    );
  return (
    <span className="owner-chips">
      {ps.slice(0, max).map((p) => (
        <Avatar key={p.id} person={p} />
      ))}
      {ps.length > max && <span className="avatar more">+{ps.length - max}</span>}
    </span>
  );
}

export function DueChip({ due, done, prefix = "" }) {
  if (!due) return null;
  const t = todayISO();
  const d = diffDays(due, t);
  const cls = done ? "" : d < 0 ? "over" : d <= 2 ? "soon" : "";
  return (
    <span className={"due " + cls} title={`Deadline ${fmtDate(due, { dow: true })}`}>
      {prefix}
      {d === 0 && !done ? "Today" : d === 1 && !done ? "Tomorrow" : fmtDate(due)}
    </span>
  );
}

export function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.planning;
  return (
    <span className={"pill st-" + s.id} title={s.hint}>
      {s.label}
    </span>
  );
}

export function StatusSelect({ value, onChange }) {
  return (
    <div className="seg">
      {STATUSES.map((s) => (
        <button key={s.id} className={"seg-b st-" + s.id + (value === s.id ? " on" : "")} title={s.hint} onClick={() => onChange(s.id)}>
          {s.label}
        </button>
      ))}
    </div>
  );
}

/* click-outside popover */
export function Popover({ open, onClose, children, className = "", anchor = "left" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => ref.current && !ref.current.contains(e.target) && onClose();
    const k = (e) => e.key === "Escape" && onClose();
    setTimeout(() => document.addEventListener("mousedown", h), 0);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className={"popover " + anchor + " " + className}>
      {children}
    </div>
  );
}

export function PeoplePicker({ value = [], onChange, label = "Owners" }) {
  const { db, create } = useDB();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const people = Object.values(db.person)
    .filter((p) => !p.archived || value.includes(p.id))
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
  const shown = people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const addNew = () => {
    const name = q.trim();
    if (!name) return;
    const p = create("person", { name, role: "", color: PALETTE[people.length % PALETTE.length], sort: people.length });
    onChange([...value, p.id]);
    setQ("");
  };
  return (
    <div className="picker">
      <button className="picker-btn" onClick={() => setOpen(!open)}>
        {value.length ? <OwnerChips ids={value} names /> : <span className="muted">+ {label}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)}>
        <input
          autoFocus
          className="pop-search"
          placeholder="Find or add a person…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") shown.length === 1 ? toggle(shown[0].id) : addNew();
          }}
        />
        <div className="pop-list">
          {shown.map((p) => (
            <label key={p.id} className="pop-row">
              <input type="checkbox" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
              <Avatar person={p} size={20} />
              <span>{p.name}</span>
              {p.role && <span className="muted small">{p.role}</span>}
            </label>
          ))}
          {q.trim() && !people.some((p) => p.name.toLowerCase() === q.trim().toLowerCase()) && (
            <button className="pop-row add" onClick={addNew}>
              + Add “{q.trim()}” as a new person
            </button>
          )}
        </div>
      </Popover>
    </div>
  );
}

export function Modal({ title, onClose, children, wide, footer }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal" + (wide ? " wide" : "")}>
        <div className="modal-h">
          <h3>{title}</h3>
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function AutoText({ value, onChange, placeholder, className = "", minRows = 2, onBlur, autoFocus }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!autoFocus || !ref.current) return;
    const el = ref.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + 2 + "px";
  }, [value]);
  return <textarea ref={ref} rows={minRows} className={"autotext " + className} value={value || ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />;
}

/* text input that only commits on blur/enter (so we don't write on every keystroke for titles) */
export function InlineInput({ value, onCommit, className = "", placeholder, autoFocus }) {
  const [v, setV] = useState(value || "");
  useEffect(() => setV(value || ""), [value]);
  return (
    <input
      className={"inline-input " + className}
      value={v}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== (value || "") && onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.target.blur();
        if (e.key === "Escape") (setV(value || ""), setTimeout(() => e.target.blur()));
      }}
    />
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function CheckCircle({ done, onClick, title = "Mark complete" }) {
  return (
    <button
      className={"check" + (done ? " done" : "")}
      title={done ? "Completed" : title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {done ? "✓" : ""}
    </button>
  );
}

export const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return true;
  }
};
