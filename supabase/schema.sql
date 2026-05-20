create table if not exists public.songs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  artist text not null,
  song_key text not null default '',
  capo text not null default '',
  tuning text not null default '',
  tags text[] not null default '{}',
  source_url text not null default '',
  raw_content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.songs enable row level security;

drop policy if exists "Users can read their own songs" on public.songs;
create policy "Users can read their own songs"
on public.songs for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own songs" on public.songs;
create policy "Users can insert their own songs"
on public.songs for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own songs" on public.songs;
create policy "Users can update their own songs"
on public.songs for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own songs" on public.songs;
create policy "Users can delete their own songs"
on public.songs for delete
using (auth.uid() = user_id);

create index if not exists songs_user_updated_idx
on public.songs (user_id, updated_at desc);

create table if not exists public.playlists (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  song_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.playlists enable row level security;

drop policy if exists "Users can read their own playlists" on public.playlists;
create policy "Users can read their own playlists"
on public.playlists for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own playlists" on public.playlists;
create policy "Users can insert their own playlists"
on public.playlists for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own playlists" on public.playlists;
create policy "Users can update their own playlists"
on public.playlists for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own playlists" on public.playlists;
create policy "Users can delete their own playlists"
on public.playlists for delete
using (auth.uid() = user_id);

create index if not exists playlists_user_updated_idx
on public.playlists (user_id, updated_at desc);
