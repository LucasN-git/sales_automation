-- Phase 7b: editierbares User-Profil.
--
-- Bisher hat die App nur auth.users (Supabase Auth) gekannt - der User-Name
-- war einfach der Email-Local-Part. Jetzt soll im Account-Drawer der Sidebar
-- ein Display-Name gesetzt werden koennen. Eigene Tabelle statt
-- auth.users.user_metadata, weil:
--   - RLS-native (auth.users laesst keine spaltenweise Policy zu),
--   - Schema-Evolution per Migration statt JSON-Drift,
--   - identisches Pattern wie app_settings (1:1-User-Erweiterung).

create table if not exists user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  updated_at timestamptz not null default now()
);

drop trigger if exists user_profiles_updated_at on user_profiles;
create trigger user_profiles_updated_at before update on user_profiles
  for each row execute function set_updated_at();

alter table user_profiles enable row level security;

drop policy if exists "user_profiles_owner_all" on user_profiles;
create policy "user_profiles_owner_all" on user_profiles for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_profiles'
  ) then
    alter publication supabase_realtime add table public.user_profiles;
  end if;
end $$;
