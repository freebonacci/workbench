import { Component, useEffect, useMemo, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Store, DEMO } from "./store.js";
import { PASSWORD_HINT, WORK_USERS } from "./config.js";
import { useDatabase, DBContext, KINDS } from "./db.js";
import { AppContext, ItemEditor } from "./item.jsx";
import { Popover } from "./ui.jsx";
import { todayISO } from "./logic.js";
import { Planner } from "./views/planner.jsx";
import { People } from "./views/people.jsx";
import { Gantt } from "./views/gantt.jsx";
import { ListView, Priorities, Completed, Meetings, Mentorship } from "./views/pages.jsx";

const PAGES = [
  ["planner", "Planner"],
  ["priorities", "Priorities"],
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
  const [menu, setMenu] = useState(false);

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
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 9000);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  // (the person/group filter was removed to keep things simple; pages still accept this hook)
  const focusMatch = useMemo(() => {
    const f = () => true;
    f.active = false;
    return f;
  }, []);
  const appCtx = { openItem: setItemId, setPage, focusMatch, focusActive: false, page };

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
              {status !== "saved" && status !== "loading" && (
                <span className={"saved " + status}>{status === "saving" ? "Saving…" : "⚠ Not saved yet — retrying"}</span>
              )}
              <div className="rel">
                <button className="me-btn" onClick={() => setMenu(!menu)}>
                  {me || "Menu"} ▾
                </button>
                <Popover open={menu} onClose={() => setMenu(false)} anchor="right">
                  <div className="pop-list">
                    <button className="pop-row" onClick={() => (exportJSON(), setMenu(false))}>
                      Download a backup
                    </button>
                    <button className="pop-row" onClick={() => (importJSON(), setMenu(false))}>
                      Load data from a file…
                    </button>
                    <a className="pop-row" href="../">
                      Go to my personal Workbench
                    </a>
                    <button className="pop-row" onClick={onSignOut}>
                      Sign out
                    </button>
                  </div>
                </Popover>
              </div>
            </div>
          </header>
          <main className="main">
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
            {itemId && db.item[itemId] && <ItemEditor key={itemId} id={itemId} onClose={() => setItemId(null)} />}
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
