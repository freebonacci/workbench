/* Pure helpers: ids, dates, tree, scheduling (blocker push), sharing. No React here. */

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const token = () => {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
};

/* ---------------- dates (all 'YYYY-MM-DD', computed in UTC to dodge timezone drift) ---------------- */
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const toUTC = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * 86400000);
export const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / 86400000); // a - b
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const fmtDate = (iso, opts = {}) => {
  if (!iso) return "";
  const d = new Date(toUTC(iso));
  const s = `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
  const y = d.getUTCFullYear() !== new Date().getFullYear() ? ` ${d.getUTCFullYear()}` : "";
  return (opts.dow ? DOW[d.getUTCDay()] + " " : "") + s + y;
};
export const monthLabel = (iso) => {
  const d = new Date(toUTC(iso));
  return `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
export const dow = (iso) => new Date(toUTC(iso)).getUTCDay();
export const weekStart = (iso) => addDays(iso, -((dow(iso) + 6) % 7)); // Monday

/* due-date bucket for lists */
export function bucketOf(due, today = todayISO()) {
  if (!due) return "none";
  const d = diffDays(due, today);
  if (d < 0) return "overdue";
  const endOfWeek = addDays(weekStart(today), 6);
  if (due <= endOfWeek) return "week";
  if (due <= addDays(endOfWeek, 7)) return "next";
  return "later";
}
export const BUCKETS = [
  ["overdue", "Overdue"],
  ["week", "This week"],
  ["next", "Next week"],
  ["later", "Later"],
  ["none", "No deadline"],
];

/* ---------------- statuses ---------------- */
export const STATUSES = [
  { id: "planning", label: "Planning", hint: "Agreed it needs doing, not started" },
  { id: "standup", label: "Standup", hint: "In progress — not yet at initial implementation" },
  { id: "mature", label: "Mature", hint: "Implemented — monitoring as it becomes permanent" },
  { id: "someday", label: "Someday", hint: "Parked" },
  { id: "complete", label: "Complete", hint: "Done" },
];
export const STATUS = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

/* ---------------- tree ---------------- */
export function childrenIndex(items) {
  const idx = {};
  for (const it of Object.values(items)) {
    const p = it.parent_id || "";
    (idx[p] = idx[p] || []).push(it);
  }
  for (const k in idx) idx[k].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || (a.created_at || "").localeCompare(b.created_at || ""));
  return idx;
}
export function ancestors(items, id) {
  const out = [];
  let cur = items[id];
  let guard = 0;
  while (cur && cur.parent_id && guard++ < 50) {
    cur = items[cur.parent_id];
    if (cur) out.unshift(cur);
  }
  return out;
}
/* "🏡 OTP › 📦 Supply challenges" — the area/stream (and parent task) above an item */
export function pathLabel(items, id, { sep = " › ", withTasks = true } = {}) {
  return ancestors(items, id)
    .filter((a) => withTasks || a.kind !== "task")
    .map((a) => (a.emoji ? a.emoji + " " : "") + a.title)
    .join(sep);
}
export const streamOf = (items, id) => ancestors(items, id).find((a) => a.kind === "stream") || null;
export const areaOf = (items, id) => ancestors(items, id).find((a) => a.kind === "area") || null;

export function isClosed(items, it) {
  if (!it) return true;
  if (it.status === "complete") return true;
  return ancestors(items, it.id).some((a) => a.status === "complete");
}
export function isHidden(items, it) {
  if (it.private) return true;
  return ancestors(items, it.id).some((a) => a.private);
}
export function descendants(items, id, idx = childrenIndex(items)) {
  const out = [];
  const walk = (pid) => (idx[pid] || []).forEach((c) => (out.push(c), walk(c.id)));
  walk(id);
  return out;
}
export const openTasks = (items) => Object.values(items).filter((it) => it.kind === "task" && !isClosed(items, it));

/* derived span for streams/areas */
export function spanOf(items, id, idx) {
  let s = null,
    e = null;
  for (const d of descendants(items, id, idx)) {
    if (d.kind !== "task" || d.status === "complete") continue;
    if (d.start && (!s || d.start < s)) s = d.start;
    const end = d.due || d.start;
    if (end && (!e || end > e)) e = end;
  }
  return { start: s, end: e };
}

/* ---------------- blockers & push scheduling ---------------- */
export function dependentsIndex(items) {
  const idx = {};
  for (const it of Object.values(items))
    for (const b of it.blocked_by || []) (idx[b] = idx[b] || []).push(it.id);
  return idx;
}
/* would making `itemId` wait on `blockerId` create a loop? */
export function wouldCycle(items, itemId, blockerId) {
  if (itemId === blockerId) return true;
  const seen = new Set();
  const stack = [blockerId];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === itemId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    (items[cur]?.blocked_by || []).forEach((b) => stack.push(b));
  }
  return false;
}
export function openBlockers(items, it) {
  return (it.blocked_by || []).map((b) => items[b]).filter((b) => b && !isClosed(items, b));
}
/* the earliest an item may start: the day after its latest open blocker's deadline */
export function requiredStart(items, it) {
  let req = null;
  for (const b of openBlockers(items, it)) {
    const end = b.due || null;
    if (!end) continue;
    const r = addDays(end, 1);
    if (!req || r > req) req = r;
  }
  return req;
}
/* everything blocked only by finished items, but scheduled in the future */
export const canStartNow = (items, it, today = todayISO()) =>
  (it.blocked_by || []).length > 0 && openBlockers(items, it).length === 0 && it.start && it.start > today && it.status !== "complete";

/* Push-only-if-needed. Starting from `seedIds`, walk the "waiting on" chain and push any
   item that would now start before its blocker finishes. Durations are kept. Never pulls earlier.
   Returns [{id, start, due, prevStart, prevDue, because}] — does not mutate. */
export function propagate(items, seedIds) {
  const work = { ...items };
  const deps = dependentsIndex(items);
  const queue = [...seedIds];
  const moved = new Map();
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const id = queue.shift();
    for (const did of deps[id] || []) {
      const d = work[did];
      if (!d || d.status === "complete") continue;
      const req = requiredStart(work, d);
      if (!req) continue;
      if (d.start && d.start >= req) continue;
      const shift = d.start ? diffDays(req, d.start) : 0;
      let due = d.due ? addDays(d.due, shift) : null;
      if (due && due < req) due = req;
      const prev = moved.get(did) || { prevStart: d.start || null, prevDue: d.due || null };
      moved.set(did, { id: did, start: req, due, ...prev, because: id });
      work[did] = { ...d, start: req, due };
      queue.push(did);
    }
  }
  return [...moved.values()];
}

/* ---------------- sharing (mirrors get_share() in SQL, used for copy/print + demo links) ---------------- */
export function shareItems(items, people, personIds) {
  const set = new Set(personIds);
  const name = (id) => people[id]?.name || "?";
  return Object.values(items)
    .filter((it) => it.kind === "task" && !isClosed(items, it) && !isHidden(items, it) && (it.owners || []).some((o) => set.has(o)))
    .map((it) => ({
      id: it.id,
      title: it.title,
      description: it.description || "",
      start: it.start,
      due: it.due,
      status: it.status,
      path: ancestors(items, it.id).map((a) => (a.emoji ? a.emoji + " " : "") + a.title),
      owner_ids: it.owners || [],
      owners: (it.owners || []).map(name),
      blockers: (it.blocked_by || [])
        .map((b) => items[b])
        .filter(Boolean)
        .map((b) => ({
          title: isHidden(items, b) ? "A private item" : b.title,
          due: b.due,
          done: isClosed(items, b),
          owners: (b.owners || []).map(name),
        })),
    }));
}

const byDue = (a, b) => (a.due || "9999").localeCompare(b.due || "9999") || a.title.localeCompare(b.title);

/* Group shared items for display. layout: 'person' | 'stream' */
export function groupShare(list, people, personIds, layout) {
  if (layout === "stream") {
    const g = {};
    for (const it of list) {
      const k = it.path.slice(0, 2).join(" › ") || "Other";
      (g[k] = g[k] || []).push(it);
    }
    return Object.entries(g)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ title: k, items: v.sort(byDue) }));
  }
  return personIds.map((pid) => ({
    title: people.find ? people.find((p) => p.id === pid)?.name : people[pid]?.name,
    pid,
    items: list.filter((it) => it.owner_ids.includes(pid)).sort(byDue),
  }));
}

/* WhatsApp/Slack friendly text */
export function shareText({ label, groups, layout, today = todayISO() }) {
  const lines = [`*${label} — open items* (${fmtDate(today)})`, ""];
  for (const g of groups) {
    if (!g.items.length) continue;
    lines.push(`*${g.title}*`);
    for (const it of g.items) {
      const bits = [];
      if (layout === "stream") bits.push(it.owners.join(", "));
      if (it.due) bits.push((it.due < today ? "⚠️ overdue, was due " : "due ") + fmtDate(it.due));
      const where = layout === "person" ? it.path.slice(1).join(" › ") : it.path.slice(2).join(" › ");
      lines.push(`• ${it.title}${bits.length ? " — " + bits.filter(Boolean).join(" · ") : ""}`);
      if (where) lines.push(`   _${where}_`);
      if (it.description) it.description.split("\n").filter(Boolean).forEach((l) => lines.push("   " + l.trim()));
      for (const b of it.blockers.filter((b) => !b.done))
        lines.push(`   ⏳ Waiting on: ${b.title}${b.owners.length ? " (" + b.owners.join(", ") + ")" : ""}${b.due ? ", due " + fmtDate(b.due) : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
