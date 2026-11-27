-- Community camera submissions for Now Here.
-- Nobody writes to this table directly: submissions arrive through the `submit-cam` Edge Function
-- (which checks the stream), and only the reviewer (through `review-cams`, admin key) can approve.
-- The public can read approved cams only, and only their public columns.

create table if not exists public.cam_submissions (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  video_id         text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  name             text not null check (char_length(name) between 2 and 80),
  place            text not null check (char_length(place) between 2 and 120),
  country          text check (char_length(country) <= 80),
  lat              double precision not null check (lat between -90 and 90),
  lon              double precision not null check (lon between -180 and 180),
  tz               text check (char_length(tz) <= 64),
  category         text not null check (category in ('city','nature','wildlife','beach','port','mountain','rail','aviation','sky','underwater')),
  channel          text check (char_length(channel) <= 120),
  channel_url      text check (char_length(channel_url) <= 300),
  title            text check (char_length(title) <= 300),
  owner_attested   boolean not null check (owner_attested),
  -- private (never readable by the public):
  contact          text check (char_length(contact) <= 200),
  note             text check (char_length(note) <= 600),
  ip_hash          text,
  check_embeddable boolean,
  check_live       boolean,
  status           text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_at      timestamptz,
  review_note      text check (char_length(review_note) <= 600)
);

-- one live entry per stream (a rejected one can be resubmitted)
create unique index if not exists cam_submissions_video_active on public.cam_submissions (video_id) where status <> 'rejected';
create index if not exists cam_submissions_status_created on public.cam_submissions (status, created_at desc);
create index if not exists cam_submissions_ip_created on public.cam_submissions (ip_hash, created_at desc);

alter table public.cam_submissions enable row level security;

-- lock it down, then open exactly what the public globe needs
revoke all on public.cam_submissions from anon, authenticated;
grant select (id, video_id, name, place, country, lat, lon, tz, category, channel, channel_url, title, reviewed_at)
  on public.cam_submissions to anon, authenticated;

drop policy if exists "Approved cams are public" on public.cam_submissions;
create policy "Approved cams are public" on public.cam_submissions
  for select to anon, authenticated
  using (status = 'approved');
