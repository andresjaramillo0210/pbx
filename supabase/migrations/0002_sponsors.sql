-- Sponsors per division. Admin uploads logos via Supabase Storage and we
-- store just the public URL here. Size controls how they lay out on the
-- public court board: LARGE = full-width banner row, MEDIUM = two per row,
-- SMALL = four per row (logo strip).

create type sponsor_size as enum ('large', 'medium', 'small');

create table sponsors (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references divisions(id) on delete cascade,
  image_url text not null,
  size sponsor_size not null default 'medium',
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

create index sponsors_division_idx on sponsors(division_id);

-- Same access pattern as the other division-scoped tables: anon can read
-- once the parent tournament is non-draft; authenticated admins can write.
alter table sponsors enable row level security;

create policy "public read sponsors"
  on sponsors for select
  using (exists (
    select 1 from divisions d
    join tournaments t on t.id = d.tournament_id
    where d.id = sponsors.division_id and t.status <> 'draft'));

create policy "admin write sponsors"
  on sponsors for all
  to authenticated
  using (true)
  with check (true);

grant select on sponsors to anon, authenticated;
grant insert, update, delete on sponsors to authenticated;

-- Storage bucket for sponsor logos. Public read so the venue TV (anon user)
-- can fetch the images; authenticated admins can upload/delete.
insert into storage.buckets (id, name, public)
values ('sponsors', 'sponsors', true)
on conflict (id) do nothing;

create policy "public read sponsor images"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'sponsors');

create policy "auth upload sponsor images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'sponsors');

create policy "auth delete sponsor images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'sponsors');
