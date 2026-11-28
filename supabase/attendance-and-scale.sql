-- GoGuard: attendance settings + indexes for scale.
-- Safe to run more than once.

-- 1. Attendance settings ---------------------------------------------------
-- The local time a pupil's presence for the day is confirmed, and the school's
-- own week/holiday list: {"weekdays":[1,2,3,4,5],"holidays":["2026-12-25"]}
alter table public.organizations
  add column if not exists attendance_cutoff time not null default '10:00',
  add column if not exists school_calendar jsonb not null default '{}'::jsonb,
  -- Parents may phone the bus crew from the parent app unless the school opts out.
  add column if not exists allow_parent_calls boolean not null default true,
  -- Used by the 30-minute and 1-hour "not picked up" warnings.
  add column if not exists school_closes_at time not null default '15:00';

-- 2. Indexes used by the live feed, attendance and fleet history -----------
create index if not exists gate_logs_org_time_idx
  on public.gate_logs (org_id, timestamp desc);

create index if not exists gate_logs_member_time_idx
  on public.gate_logs (member_id, timestamp desc);

create index if not exists gate_logs_emailed_idx
  on public.gate_logs (timestamp)
  where emailed_at is null;

create index if not exists pupil_bus_logs_org_time_idx
  on public.pupil_bus_logs (org_id, timestamp desc);

create index if not exists pupil_bus_logs_trip_idx
  on public.pupil_bus_logs (trip_id, member_id);

create index if not exists bus_trips_org_status_idx
  on public.bus_trips (org_id, status, started_at desc);

create index if not exists transport_notices_org_created_idx
  on public.transport_notices (org_id, created_at desc);

create index if not exists transport_notices_unemailed_idx
  on public.transport_notices (created_at)
  where emailed_at is null;

create index if not exists members_org_branch_idx
  on public.members (org_id, branch_id);

create index if not exists guardians_org_idx
  on public.guardians (org_id);

create index if not exists guardians_member_idx
  on public.guardians (member_id);

-- 3. Pass codes are looked up on every scan: keep that lookup an index hit --
create index if not exists guardians_qr_hash_idx
  on public.guardians (unique_qr_hash);
