-- =====================================================================
-- Workbench · WORK side — one-time setup
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to re-run. Does not touch the personal `boards` table.
-- =====================================================================

-- The only two work logins. Must match WORK_USERS in work/src/config.js.
create or replace function public.is_work_user() returns boolean
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in ('benjamin@taimaka.org', 'justin@taimaka.org')
$$;

-- Everything on the work side lives in one flexible table:
--   kind = person | group | priority | item | meeting | mentor | share
create table if not exists public.work_rows (
  id         text primary key,
  kind       text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists work_rows_kind_idx on public.work_rows(kind);

alter table public.work_rows enable row level security;
drop policy if exists "work user only" on public.work_rows;
create policy "work user only" on public.work_rows
  for all to authenticated
  using (public.is_work_user())
  with check (public.is_work_user());

-- Live updates between Ben + Justin
do $$ begin
  alter publication supabase_realtime add table public.work_rows;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Live personal links: read-only view for one person or a group.
-- Returns ONLY open, non-private items they own, with shared
-- descriptions. Internal notes are never returned.
-- ---------------------------------------------------------------------
create or replace function public.get_share(t text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s    jsonb;
  pids text[];
begin
  if t is null or length(t) < 24 then return null; end if;

  select data into s from work_rows
   where kind = 'share' and id = t
     and coalesce((data ->> 'revoked')::boolean, false) = false;
  if s is null then return null; end if;

  select coalesce(array_agg(x), '{}') into pids
    from jsonb_array_elements_text(coalesce(s -> 'person_ids', '[]'::jsonb)) x;

  return (
    with recursive tree as (
      select r.id, r.data, 0 as depth,
             coalesce((r.data ->> 'private')::boolean, false) as hidden,
             coalesce(r.data ->> 'status', '') = 'complete' as closed,
             array[]::text[] as path
        from work_rows r
       where r.kind = 'item' and coalesce(r.data ->> 'parent_id', '') = ''
      union all
      select c.id, c.data, t.depth + 1,
             t.hidden or coalesce((c.data ->> 'private')::boolean, false),
             t.closed or coalesce(c.data ->> 'status', '') = 'complete',
             t.path || trim(coalesce(t.data ->> 'emoji', '') || ' ' || (t.data ->> 'title'))
        from work_rows c
        join tree t on c.data ->> 'parent_id' = t.id
       where c.kind = 'item' and t.depth < 12
    ),
    people as (
      select id, data ->> 'name' as name from work_rows where kind = 'person'
    ),
    mine as (
      select * from tree
       where (data ->> 'kind') = 'task' and not hidden and not closed
         and exists (select 1 from jsonb_array_elements_text(coalesce(data -> 'owners', '[]')) o
                      where o = any(pids))
    )
    select jsonb_build_object(
      'label', s ->> 'label',
      'layout', coalesce(s ->> 'layout', 'person'),
      'generated_at', now(),
      'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name)), '[]')
                   from people p where p.id = any(pids)),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', m.id,
          'title', m.data ->> 'title',
          'description', coalesce(m.data ->> 'description', ''),
          'start', m.data ->> 'start',
          'due', m.data ->> 'due',
          'status', m.data ->> 'status',
          'path', to_jsonb(m.path),
          'owner_ids', coalesce(m.data -> 'owners', '[]'),
          'owners', (select coalesce(jsonb_agg(p.name), '[]') from people p
                      where p.id in (select jsonb_array_elements_text(coalesce(m.data -> 'owners', '[]')))),
          'blockers', (select coalesce(jsonb_agg(jsonb_build_object(
                'title', case when b.hidden then 'A private item' else b.data ->> 'title' end,
                'due', b.data ->> 'due',
                'done', b.closed,
                'owners', (select coalesce(jsonb_agg(p.name), '[]') from people p
                            where p.id in (select jsonb_array_elements_text(coalesce(b.data -> 'owners', '[]'))))
              )), '[]')
              from tree b
             where b.id in (select jsonb_array_elements_text(coalesce(m.data -> 'blocked_by', '[]'))))
        )), '[]') from mine m)
    )
  );
end $$;

revoke all on function public.get_share(text) from public;
grant execute on function public.get_share(text) to anon, authenticated;
