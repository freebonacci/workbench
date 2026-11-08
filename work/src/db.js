import { useEffect, useRef, useState, useCallback, createContext, useContext } from "react";
import { Store } from "./store.js";
import { uid, todayISO, propagate, fmtDate } from "./logic.js";

/* In-memory database for the app: { person:{}, group:{}, priority:{}, item:{}, meeting:{}, mentor:{}, share:{} }
   Edits apply instantly and are written to the backend shortly after (debounced per row).
   Changes from the other person arrive via realtime and merge in. */

export const KINDS = ["person", "group", "priority", "item", "meeting", "mentor", "share"];
const empty = () => Object.fromEntries(KINDS.map((k) => [k, {}]));

export const DBContext = createContext(null);
export const useDB = () => useContext(DBContext);

export function useDatabase(enabled) {
  const [db, setDb] = useState(empty);
  const [status, setStatus] = useState("loading"); // loading | saved | saving | error
  const [toast, setToast] = useState(null);
  const dbRef = useRef(db);
  dbRef.current = db;
  const pending = useRef(new Map()); // id -> {kind, data|null}
  const timer = useRef(null);
  const flushing = useRef(false);

  const load = useCallback(async () => {
    const rows = await Store.loadAll();
    const next = empty();
    rows.forEach((r) => {
      if (!next[r.kind]) return;
      const d = { ...r.data, id: r.id };
      // older data had a separate "shared description"; it now lives in Notes
      if (r.kind === "item" && d.description) {
        d.notes = d.notes ? d.description + "\n\n" + d.notes : d.description;
        d.description = "";
      }
      next[r.kind][r.id] = d;
    });
    setDb(next);
    setStatus("saved");
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load().catch((e) => {
      console.error(e);
      setStatus("error");
    });
    const unsub = Store.subscribe((ev) => {
      if (ev.type === "delete") {
        if (pending.current.has(ev.id)) return;
        setDb((d) => {
          for (const k of KINDS)
            if (d[k][ev.id]) {
              const m = { ...d[k] };
              delete m[ev.id];
              return { ...d, [k]: m };
            }
          return d;
        });
      } else {
        const r = ev.row;
        if (pending.current.has(r.id) || !KINDS.includes(r.kind)) return;
        setDb((d) => ({ ...d, [r.kind]: { ...d[r.kind], [r.id]: { ...r.data, id: r.id } } }));
      }
    });
    const onFocus = () => !pending.current.size && load().catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, load]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    clearTimeout(timer.current);
    const batch = [...pending.current.entries()];
    pending.current.clear();
    const puts = batch.filter(([, v]) => v.data).map(([id, v]) => ({ id, kind: v.kind, data: v.data }));
    const dels = batch.filter(([, v]) => !v.data).map(([id]) => id);
    try {
      setStatus("saving");
      await Store.put(puts);
      await Store.del(dels);
      setStatus(pending.current.size ? "saving" : "saved");
    } catch (e) {
      console.error(e);
      batch.forEach(([id, v]) => !pending.current.has(id) && pending.current.set(id, v));
      setStatus("error");
      timer.current = setTimeout(flush, 5000);
    } finally {
      flushing.current = false;
      if (pending.current.size) timer.current = setTimeout(flush, 600);
    }
  }, []);

  useEffect(() => {
    const h = (e) => {
      if (pending.current.size) {
        flush();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [flush]);

  const queue = (kind, id, data) => {
    pending.current.set(id, { kind, data });
    setStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };

  /* ------------ generic writes ------------ */
  const putMany = useCallback((list) => {
    // list: [{kind, data}] — data must include id
    setDb((d) => {
      const n = { ...d };
      for (const { kind, data } of list) {
        n[kind] = n[kind] === d[kind] ? { ...d[kind] } : n[kind];
        n[kind][data.id] = data;
        queue(kind, data.id, (({ id, ...rest }) => rest)(data));
      }
      return n;
    });
  }, []);
  const put = useCallback((kind, data) => putMany([{ kind, data }]), [putMany]);
  const patch = useCallback(
    (kind, id, p) => {
      const cur = dbRef.current[kind][id];
      if (!cur) return;
      put(kind, { ...cur, ...p, updated_at: new Date().toISOString() });
    },
    [put]
  );
  const removeMany = useCallback((kind, ids) => {
    setDb((d) => {
      const m = { ...d[kind] };
      ids.forEach((id) => {
        delete m[id];
        queue(kind, id, null);
      });
      return { ...d, [kind]: m };
    });
  }, []);
  const remove = useCallback((kind, id) => removeMany(kind, [id]), [removeMany]);
  const create = useCallback(
    (kind, data) => {
      const row = { id: uid(), created_at: new Date().toISOString(), ...data };
      put(kind, row);
      return row;
    },
    [put]
  );

  /* ------------ items, with blocker push + undo ------------ */
  const updateItem = useCallback(
    (id, p, { silent = false } = {}) => {
      const items = dbRef.current.item;
      const cur = items[id];
      if (!cur) return;
      const next = { ...cur, ...p, updated_at: new Date().toISOString() };
      if (p.status === "complete" && cur.status !== "complete") next.completed_at = new Date().toISOString();
      if (p.status && p.status !== "complete" && cur.status === "complete") next.completed_at = null;
      const scheduleChanged = ["start", "due", "blocked_by", "status"].some((k) => k in p && JSON.stringify(p[k]) !== JSON.stringify(cur[k]));
      const before = [cur];
      const writes = [{ kind: "item", data: next }];
      let moved = [];
      if (scheduleChanged) {
        // If this item now starts before its own blockers finish, it moves too.
        const work = { ...items, [id]: next };
        moved = propagate(work, [id]);
        for (const m of moved) {
          const it = work[m.id];
          before.push(items[m.id]);
          const cause = work[m.because];
          const hist = [
            ...(it.history || []),
            { at: todayISO(), text: `Pushed ${fmtDate(m.prevStart) || "—"} → ${fmtDate(m.start)} because “${cause?.title || "a blocker"}” moved` },
          ].slice(-30);
          writes.push({ kind: "item", data: { ...it, start: m.start, due: m.due, history: hist } });
        }
      }
      putMany(writes);
      if (moved.length && !silent) {
        setToast({
          id: uid(),
          text: `Moved ${moved.length} waiting item${moved.length > 1 ? "s" : ""}: ` + moved.slice(0, 3).map((m) => items[m.id]?.title).join("; ") + (moved.length > 3 ? "…" : ""),
          undo: () => putMany(before.map((b) => ({ kind: "item", data: b }))),
        });
      }
      return moved;
    },
    [putMany]
  );

  /* make `id` wait on `blockerId`; pushes `id` itself if needed */
  const addBlocker = useCallback(
    (id, blockerId) => {
      const items = dbRef.current.item;
      const cur = items[id];
      const blocker = items[blockerId];
      if (!cur || !blocker) return;
      const bb = [...new Set([...(cur.blocked_by || []), blockerId])];
      const work = { ...items, [id]: { ...cur, blocked_by: bb } };
      const moved = propagate(work, [blockerId]);
      const before = [cur, ...moved.filter((m) => m.id !== id).map((m) => items[m.id])];
      const writes = [];
      const self = moved.find((m) => m.id === id);
      writes.push({
        kind: "item",
        data: {
          ...work[id],
          ...(self ? { start: self.start, due: self.due, history: [...(cur.history || []), { at: todayISO(), text: `Pushed ${fmtDate(self.prevStart) || "—"} → ${fmtDate(self.start)} to wait for “${blocker.title}”` }] } : {}),
        },
      });
      for (const m of moved.filter((m) => m.id !== id)) {
        const it = items[m.id];
        writes.push({
          kind: "item",
          data: { ...it, start: m.start, due: m.due, history: [...(it.history || []), { at: todayISO(), text: `Pushed ${fmtDate(m.prevStart)} → ${fmtDate(m.start)} (chain from “${cur.title}”)` }] },
        });
      }
      putMany(writes);
      if (moved.length)
        setToast({
          id: uid(),
          text: `Moved ${moved.length} item${moved.length > 1 ? "s" : ""} to wait for “${blocker.title}”`,
          undo: () => putMany(before.map((b) => ({ kind: "item", data: b }))),
        });
    },
    [putMany]
  );

  const deleteItem = useCallback(
    (id, { quiet = false } = {}) => {
      const items = dbRef.current.item;
      const ids = new Set([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const it of Object.values(items)) if (it.parent_id && ids.has(it.parent_id) && !ids.has(it.id)) (ids.add(it.id), (grew = true));
      }
      const removed = [...ids].map((i) => items[i]);
      // unhook anything that was waiting on deleted items
      const fixes = Object.values(items)
        .filter((it) => !ids.has(it.id) && (it.blocked_by || []).some((b) => ids.has(b)))
        .map((it) => ({ before: it, after: { ...it, blocked_by: it.blocked_by.filter((b) => !ids.has(b)) } }));
      removeMany("item", [...ids]);
      if (fixes.length) putMany(fixes.map((f) => ({ kind: "item", data: f.after })));
      if (quiet) return;
      setToast({
        id: uid(),
        text: `Deleted “${items[id].title}”${ids.size > 1 ? ` and ${ids.size - 1} sub-item${ids.size > 2 ? "s" : ""}` : ""}`,
        undo: () => putMany([...removed.map((r) => ({ kind: "item", data: r })), ...fixes.map((f) => ({ kind: "item", data: f.before }))]),
      });
    },
    [removeMany, putMany]
  );

  const replaceAll = useCallback(
    async (rows) => {
      const old = [];
      for (const k of KINDS) for (const id of Object.keys(dbRef.current[k])) old.push(id);
      setStatus("saving");
      await Store.del(old.filter((id) => !rows.some((r) => r.id === id)));
      await Store.put(rows);
      await load();
    },
    [load]
  );

  return { db, status, toast, setToast, put, putMany, patch, create, remove, removeMany, updateItem, addBlocker, deleteItem, replaceAll, reload: load };
}
