# Workbench

Two separate apps on one GitHub Pages site (repo `freebonacci/workbench`, public → https://freebonacci.github.io/workbench/).

## Personal side — `index.html` (repo root)
Ben's personal project tracker. Single self-contained file (React UMD + in-browser Babel), Supabase table `boards` (one JSON blob per user).
**Leave it alone unless Ben explicitly asks for a personal-side change.**

## Work side — `work/`
Shared program tracker for Ben (Chief of Staff) and Justin (his boss) at Taimaka. Two logins only — Ben (benjamin@taimaka.org) and Justin (justin@taimaka.org), listed in `WORK_USERS` in `work/src/config.js` and in `is_work_user()` in the SQL; passwords live in Supabase. Nobody else ever logs in; others only receive copied lists or read-only live links.

- Source: `work/src/*.jsx` → bundled by esbuild into `work/dist/main.js` and `work/dist/share.js`.
- **After editing anything in `work/src`, run `npm run build` and commit `work/dist/` too** (Pages serves the built files; there is no CI).
- `work/styles.css` is plain CSS (not bundled).
- Data: Supabase table `work_rows (id, kind, data jsonb)`; kinds = person, group, priority, item, meeting, mentor, share. Schema + RLS + the `get_share(token)` RPC live in `supabase/work-setup.sql` (Ben pastes it into the Supabase SQL editor; Claude has no direct DB access).
- Items form a tree via `parent_id`: `kind` area → stream → task (tasks can nest as sub-items). Task fields: owners[], start, due, status (planning|standup|mature|someday|complete), blocked_by[], description (shared), notes (internal — never shared), private.
- Scheduling rule (agreed with Ben): **push only if needed** — when a blocker's deadline slips, items waiting on it move later only if they'd now start before the blocker is due, keeping their duration; chains propagate; early finishes never pull items earlier; no hard deadlines. Logic in `work/src/logic.js` (`propagate`), applied in `db.js` (`updateItem`, `addBlocker`) with an Undo toast.
- Sharing (copy/print/live links), private flags, groups and the person filter were removed on 8 Nov at Ben's request to keep it simple. `get_share()` in SQL and `shareItems()` in logic.js remain unused — if sharing comes back, never expose notes.
- Each item has a single Notes field (older `description` text is merged into notes on load).
- Ben's condensed OTP section in Workflowy is the template for how areas should look; unplaced raw items live in the 📥 To sort area.
- Try changes safely with `?demo` (e.g. `work/index.html?demo`) — uses this browser's localStorage, password `taimako`.

## Never commit
`private/` (seed data built from Workflowy + `build-seed.mjs`), `WF - *` Workflowy exports, `backups/`. These contain sensitive staff/HR notes and are git-ignored. The repo is public.
