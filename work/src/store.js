import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

/* Two interchangeable backends with the same shape:
   - Supabase (real)                       — default
   - Demo (this browser's localStorage)    — add ?demo to the URL to try things safely */

export const DEMO = new URLSearchParams(location.search).has("demo");

let sb = null;
export const client = () => {
  if (!sb)
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "workbench-work-auth" },
    });
  return sb;
};

const supabaseStore = {
  async session() {
    const { data } = await client().auth.getSession();
    return data.session;
  },
  async signIn(email, password) {
    const { error } = await client().auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async signOut() {
    await client().auth.signOut();
  },
  async loadAll() {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client()
        .from("work_rows")
        .select("id,kind,data")
        .range(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  },
  async put(rows) {
    if (!rows.length) return;
    const now = new Date().toISOString();
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await client()
        .from("work_rows")
        .upsert(rows.slice(i, i + 500).map((r) => ({ id: r.id, kind: r.kind, data: r.data, updated_at: now })));
      if (error) throw error;
    }
  },
  async del(ids) {
    if (!ids.length) return;
    const { error } = await client().from("work_rows").delete().in("id", ids);
    if (error) throw error;
  },
  subscribe(cb) {
    const ch = client()
      .channel("work_rows")
      .on("postgres_changes", { event: "*", schema: "public", table: "work_rows" }, (p) => {
        if (p.eventType === "DELETE") cb({ type: "delete", id: p.old.id });
        else cb({ type: "upsert", row: { id: p.new.id, kind: p.new.kind, data: p.new.data } });
      })
      .subscribe();
    return () => client().removeChannel(ch);
  },
};

const DEMO_KEY = "workbench-work-demo";
const demoRead = () => {
  try {
    return JSON.parse(localStorage.getItem(DEMO_KEY) || "{}");
  } catch (e) {
    return {};
  }
};
const demoWrite = (m) => {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(m));
  } catch (e) {}
};
const demoStore = {
  async session() {
    const e = sessionStorage.getItem("demo-session");
    return e ? { demo: true, user: { email: e } } : null;
  },
  async signIn(email, password) {
    if (password !== "taimako") throw new Error("Wrong password");
    sessionStorage.setItem("demo-session", email);
  },
  async signOut() {
    sessionStorage.removeItem("demo-session");
  },
  async loadAll() {
    return Object.values(demoRead());
  },
  async put(rows) {
    const m = demoRead();
    rows.forEach((r) => (m[r.id] = { id: r.id, kind: r.kind, data: r.data }));
    demoWrite(m);
  },
  async del(ids) {
    const m = demoRead();
    ids.forEach((id) => delete m[id]);
    demoWrite(m);
  },
  subscribe() {
    return () => {};
  },
};

export const Store = DEMO ? demoStore : supabaseStore;
