# Workbench

Ben's personal project tracker, on GitHub Pages (repo `freebonacci/workbench`, public → https://freebonacci.github.io/workbench/).

- `index.html` — single self-contained file (React UMD + in-browser Babel), Supabase table `boards` (one JSON blob per user). No build step.
- The work-side tracker (for Ben + Justin at Taimaka) used to live in `work/` here. On 10 Nov 2026 it moved to its own repo, `program-tracker` (local folder `../program-tracker`), hosted on Coolify. Don't add work things back here.

## Never commit
`private/` (seed data built from Workflowy + `build-seed.mjs`), `WF - *` Workflowy exports, `backups/`. These contain sensitive staff/HR notes and are git-ignored. The repo is public.
