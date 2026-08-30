-- Dumps the live definitions of everything the app depends on, so the tables,
-- policies, functions and triggers created by hand before migrations were
-- tracked can be written into a checked-in baseline migration from the REAL
-- definitions rather than reconstructed from memory.
--
-- Run in the Supabase SQL editor (as-is — it only reads catalogs), then copy
-- the whole result grid (every row, the `definition` column is long) and paste
-- it back. Nothing here writes anything.

with tables as (
  select
    'TABLE'::text as kind,
    c.relname::text as name,
    format(
      'create table if not exists public.%I (%s);',
      c.relname,
      (
        select string_agg(
          format('%I %s%s%s',
            a.attname,
            format_type(a.atttypid, a.atttypmod),
            case when a.attnotnull then ' not null' else '' end,
            case when d.adbin is not null then ' default ' || pg_get_expr(d.adbin, d.adrelid) else '' end
          ),
          ', ' order by a.attnum
        )
        from pg_attribute a
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      )
    ) as definition
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
constraints as (
  select
    'CONSTRAINT'::text,
    con.conname::text,
    format('alter table public.%I add constraint %I %s;', rel.relname, con.conname, pg_get_constraintdef(con.oid))
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public'
),
indexes as (
  select 'INDEX'::text, i.indexname::text, i.indexdef || ';'
  from pg_indexes i
  where i.schemaname = 'public' and i.indexname not in (select conname from pg_constraint)
),
rls as (
  select
    'RLS'::text,
    c.relname::text,
    format('alter table public.%I %s row level security;', c.relname, case when c.relrowsecurity then 'enable' else 'disable' end)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
policies as (
  select
    'POLICY'::text,
    (p.tablename || '.' || p.policyname)::text,
    format(
      'create policy %I on public.%I as %s for %s to %s%s%s;',
      p.policyname,
      p.tablename,
      lower(p.permissive),
      lower(p.cmd),
      array_to_string(p.roles, ', '),
      case when p.qual is not null then ' using (' || p.qual || ')' else '' end,
      case when p.with_check is not null then ' with check (' || p.with_check || ')' else '' end
    )
  from pg_policies p
  where p.schemaname = 'public'
),
functions as (
  select 'FUNCTION'::text, p.proname::text, pg_get_functiondef(p.oid) || ';'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
triggers as (
  select 'TRIGGER'::text, (c.relname || '.' || t.tgname)::text, pg_get_triggerdef(t.oid) || ';'
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
    and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users'))
),
grants as (
  select
    'GRANT'::text,
    (g.table_name || ' (' || g.grantee || ')')::text,
    string_agg(g.privilege_type || case when g.column_name is not null then ' (' || g.column_name || ')' else '' end, ', ' order by g.privilege_type, g.column_name)
  from (
    select table_name, grantee, privilege_type, null::text as column_name
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('authenticated', 'anon')
    union all
    select table_name, grantee, privilege_type, column_name
    from information_schema.column_privileges
    where table_schema = 'public' and grantee in ('authenticated', 'anon')
  ) g
  group by g.table_name, g.grantee
)
select * from tables
union all select * from constraints
union all select * from indexes
union all select * from rls
union all select * from policies
union all select * from functions
union all select * from triggers
union all select * from grants
order by 1, 2;
