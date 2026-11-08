import { Component, useEffect, useMemo, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Store, DEMO } from "./store.js";
import { PASSWORD_HINT, WORK_USERS } from "./config.js";
import { useDatabase, DBContext, KINDS } from "./db.js";
import { AppContext, ItemPanel } from "./item.jsx";
import { Popover, Avatar } from "./ui.jsx";
import { descendants, isClosed, todayISO } from "./logic.js";
import { Planner } from "./views/planner.jsx";
import { People } from "./views/people.jsx";
import { Gantt } from "./views/gantt.jsx";
import { ListView, Priorities, Completed, Meetings, Mentorship } from "./views/pages.jsx";

const PAGES = [
  ["priorities", "Priorities"],
  ["planner", "Planner"],
  ["people", "People"],
  ["gantt", "Gantt"],
  ["list", "Deadlines"],
  ["meetings", "Meetings"],
  ["mentorship", "Mentorship"],
  ["completed", "Completed"],
];

class Boundary extends Component {
  constructor(p) {
    super(p);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidUpdate(prev) {
    if (prev.page !== this.props.page && this.state.err) this.setState({ err: null });
  }
  render() {
    if (this.state.err)
      return (
        <div className="empty">
          Something went wrong on this page ({String(this.state.err.message || this.state.err)}). Your data is safe — try another page or reload.
        </div>
      );
    return this.props.children;
  }
}

function Root() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    Store.session().then(setSession).catch(() => setSession(null));
  }, []);
  if (session === undefined) return <div className="splash">Workbench</div>;
  if (!session) return <Login onIn={() => Store.session().then(setSession)} />;
  const email = (session.user?.email || "").toLowerCase();
  const me = WORK_USERS.find((u) => u.email === email);
  return <App me={me ? me.name : email} onSignOut={() => Store.signOut().then(() => setSession(null))} />;
}

function Login({ onIn }) {
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem("wb-work-who") || WORK_USERS[0].email;
    } catch (e) {
      return WORK_USERS[0].email;
    }
  });
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await Store.signIn(email, pw);
      try {
        localStorage.setItem("wb-work-who", email);
      } catch (e) {}
      onIn();
    } catch (e) {
      setErr("That's not it.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form onSubmit={go} className="login-card">
        <div className="eyebrow">Workbench · Work</div>
        <h1>Program tracker</h1>
        <div className="seg who">
          {WORK_USERS.map((u) => (
            <button type="button" key={u.email} className={"seg-b" + (email === u.email ? " on" : "")} onClick={() => setEmail(u.email)}>
              {u.name}
            </button>
          ))}
        </div>
        <input type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {PASSWORD_HINT && <div className="hint-pw">Hint: {PASSWORD_HINT}</div>}
        {err && <div className="err">{err}</div>}
        <button className="btn primary" disabled={busy || !pw}>
          {busy ? "…" : "Open"}
        </button>
        {DEMO && <div className="muted small">Demo mode — data stays in this browser.</div>}
      </form>
    </div>
  );
}

function App({ me, onSignOut }) {
  const dbApi = useDatabase(true);
  const { db, status, toast, setToast } = dbApi;
  const [page, setPageState] = useState(() => (location.hash.slice(1).split("/")[0] || "planner"));
  const [pageArg, setPageArg] = useState(null);
  const [itemId, setItemId] = useState(null);
  const [focus, setFocus] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("wb-focus") || "null");
    } catch (e) {
      return null;
    }
  });
  const [menu, setMenu] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);

  const setPage = useCallback((p, arg = null) => {
    setPageState(p);
    setPageArg(arg);
    history.replaceState(null, "", "#" + p);
  }, []);
  useEffect(() => {
    const h = () => setPageState(location.hash.slice(1) || "planner");
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("wb-focus", JSON.stringify(focus));
    } catch (e) {}
  }, [focus]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 9000);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  // focus filter: a person or a saved group
  const focusIds = useMemo(() => {
    if (!focus) return null;
    if (focus.type === "person") return db.person[focus.id] ? [focus.id] : null;
    if (focus.type === "group") return db.group[focus.id]?.person_ids || null;
    return null;
  }, [focus, db.person, db.group]);
  const focusMatch = useMemo(() => {
    const f = (it, deep = false) => {
      if (!focusIds) return true;
      if ((it.owners || []).some((o) => focusIds.includes(o))) return true;
      if (deep) return descendants(db.item, it.id).some((d) => !isClosed(db.item, d) && (d.owners || []).some((o) => focusIds.includes(o)));
      return false;
    };
    f.active = !!focusIds;
    return f;
  }, [focusIds, db.item]);
  const focusLabel = focus?.type === "person" ? db.person[focus.id]?.name : focus?.type === "group" ? db.group[focus.id]?.name : null;

  const appCtx = { openItem: setItemId, setPage, focusMatch, focusActive: !!focusIds, page };

  const exportJSON = () => {
    const rows = [];
    for (const k of KINDS) for (const [id, d] of Object.entries(db[k])) rows.push({ id, kind: k, data: (({ id: _, ...r }) => r)(d) });
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), rows }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `workbench-work-backup-${todayISO()}.json`;
    a.click();
  };
  const importJSON = () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      try {
        const j = JSON.parse(await f.text());
        const rows = j.rows || [];
        if (!rows.length || !rows.every((r) => r.id && KINDS.includes(r.kind))) throw new Error("Not a Workbench work file");
        if (!confirm(`Replace EVERYTHING on the work side with ${rows.length} records from “${f.name}”?\n\nTip: Export a backup first.`)) return;
        await dbApi.replaceAll(rows);
      } catch (e) {
        alert("Couldn't import: " + e.message);
      }
    };
    inp.click();
  };

  const groups = Object.values(db.group);
  const people = Object.values(db.person).filter((p) => !p.archived).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

  return (
    <DBContext.Provider value={dbApi}>
      <AppContext.Provider value={appCtx}>
        <div className="app">
          <header className="topbar">
            <div className="brand">
              <h1>Workbench</h1>
              <span className="eyebrow">Work{DEMO ? " · demo" : ""}</span>
            </div>
            <nav className="nav">
              {PAGES.map(([k, l]) => (
                <button key={k} className={"navb" + (page === k ? " on" : "")} onClick={() => setPage(k)}>
                  {l}
                </button>
              ))}
            </nav>
            <div className="top-r">
              <div className="rel">
                <button className={"focus-btn" + (focusLabel ? " on" : "")} onClick={() => setFocusOpen(!focusOpen)} title="Show only items for a person or group">
                  {focusLabel ? <>👁 {focusLabel}</> : "👁 Everyone"}
                </button>
                <Popover open={focusOpen} onClose={() => setFocusOpen(false)} anchor="right">
                  <div className="pop-list">
                    <button className="pop-row" onClick={() => (setFocus(null), setFocusOpen(false))}>
                      Everyone
                    </button>
                    {groups.map((g) => (
                      <button key={g.id} className="pop-row" onClick={() => (setFocus({ type: "group", id: g.id }), setFocusOpen(false))}>
                        👥 {g.name}
                      </button>
                    ))}
                    {people.map((p) => (
                      <button key={p.id} className="pop-row" onClick={() => (setFocus({ type: "person", id: p.id }), setFocusOpen(false))}>
                        <Avatar person={p} size={18} /> {p.name}
                      </button>
                    ))}
                  </div>
                </Popover>
              </div>
              <span className={"saved " + status} title={status === "error" ? "Couldn't save — retrying" : ""}>
                <i />
                {status === "saving" ? "Saving" : status === "error" ? "Offline" : status === "loading" ? "Loading" : "Saved"}
              </span>
              <div className="rel">
                <button className="iconbtn" onClick={() => setMenu(!menu)} aria-label="Menu">
                  ⋯
                </button>
                <Popover open={menu} onClose={() => setMenu(false)} anchor="right">
                  <div className="pop-list">
                    <button className="pop-row" onClick={() => (exportJSON(), setMenu(false))}>
                      ⬇ Export backup (JSON)
                    </button>
                    <button className="pop-row" onClick={() => (importJSON(), setMenu(false))}>
                      ⬆ Import / replace from JSON…
                    </button>
                    <a className="pop-row" href="../">
                      ↩ Personal Workbench
                    </a>
                    <button className="pop-row" onClick={onSignOut}>
                      Sign out{me ? ` (${me})` : ""}
                    </button>
                  </div>
                </Popover>
              </div>
            </div>
          </header>
          {focusLabel && page !== "people" && page !== "meetings" && page !== "mentorship" && (
            <div className="focus-bar">
              Showing items for <b>{focusLabel}</b> only.{" "}
              <button className="link" onClick={() => setFocus(null)}>
                Show everyone
              </button>
            </div>
          )}
          <main className={"main" + (itemId ? " with-panel" : "")}>
            <div className="content">
              <Boundary page={page}>
              {page === "priorities" && <Priorities />}
              {page === "planner" && <Planner />}
              {page === "people" && <People />}
              {page === "gantt" && <Gantt />}
              {page === "list" && <ListView />}
              {page === "meetings" && <Meetings />}
              {page === "mentorship" && <Mentorship personId={pageArg} />}
              {page === "completed" && <Completed />}
              </Boundary>
            </div>
            {itemId && db.item[itemId] && <ItemPanel key={itemId} id={itemId} onClose={() => setItemId(null)} />}
          </main>
          {toast && (
            <div className="toast" key={toast.id}>
              <span>{toast.text}</span>
              {toast.undo && (
                <button
                  onClick={() => {
                    toast.undo();
                    setToast(null);
                  }}
                >
                  Undo
                </button>
              )}
              <button className="x" onClick={() => setToast(null)}>
                ×
              </button>
            </div>
          )}
        </div>
      </AppContext.Provider>
    </DBContext.Provider>
  );
}

createRoot(document.getElementById("root")).render(<Root />);
