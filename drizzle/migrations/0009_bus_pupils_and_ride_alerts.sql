-- Parents tick "uses the school bus"; each bus pupil gets a private tracking link token.
ALTER TABLE public.members ADD COLUMN uses_bus boolean NOT NULL DEFAULT false;
ALTER TABLE public.members ADD COLUMN bus_track_token text NOT NULL
  DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
CREATE UNIQUE INDEX members_bus_track_token_key ON public.members(bus_track_token);
UPDATE public.members SET uses_bus = true WHERE bus_id IS NOT NULL;

-- A pupil put on a bus is a bus pupil; the bus must belong to the same school.
CREATE OR REPLACE FUNCTION public.members_bus_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.bus_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.buses b WHERE b.id = NEW.bus_id AND b.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'This bus does not belong to this school';
    END IF;
    NEW.uses_bus := true;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.bus_track_token := OLD.bus_track_token;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.members_bus_before_write() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER members_bus_before_write
BEFORE INSERT OR UPDATE ON public.members
FOR EACH ROW EXECUTE FUNCTION public.members_bus_before_write();

-- Registration link: does this school offer transport?
CREATE OR REPLACE FUNCTION public.get_registration_transport(_token text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT transport_enabled FROM public.organizations WHERE registration_token = _token), false)
$$;
REVOKE EXECUTE ON FUNCTION public.get_registration_transport(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_registration_transport(text) TO anon, authenticated, service_role;

-- Ride alerts for bus parents: one notice per board / drop-off (never on ride start).
ALTER TABLE public.transport_notices ADD COLUMN member_id uuid REFERENCES public.members(id) ON DELETE CASCADE;
ALTER TABLE public.transport_notices ADD COLUMN trip_id uuid REFERENCES public.bus_trips(id) ON DELETE CASCADE;
ALTER TABLE public.transport_notices ADD COLUMN guardian_id uuid REFERENCES public.guardians(id) ON DELETE SET NULL;
CREATE INDEX transport_notices_org_created_idx ON public.transport_notices(org_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.pupil_bus_logs_after_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_bus_id uuid;
  v_bus text;
  v_time text;
  v_msg text;
BEGIN
  SELECT m.full_name INTO v_name FROM public.members m WHERE m.id = NEW.member_id;
  SELECT t.bus_id, b.bus_number INTO v_bus_id, v_bus
  FROM public.bus_trips t JOIN public.buses b ON b.id = t.bus_id
  WHERE t.id = NEW.trip_id;
  v_time := to_char(NEW."timestamp" AT TIME ZONE 'Africa/Lagos', 'FMHH12:MI AM');
  IF NEW.status = 'boarded' THEN
    v_msg := v_name || ' boarded Bus ' || v_bus || ' at ' || v_time || '.';
  ELSIF NEW.guardian_name IS NOT NULL THEN
    v_msg := v_name || ' was dropped off from Bus ' || v_bus || ' and handed to ' || NEW.guardian_name || ' at ' || v_time || '.';
  ELSE
    v_msg := v_name || ' was dropped off from Bus ' || v_bus || ' at ' || v_time || '.';
  END IF;
  INSERT INTO public.transport_notices (org_id, bus_id, member_id, trip_id, guardian_id, kind, message)
  VALUES (NEW.org_id, v_bus_id, NEW.member_id, NEW.trip_id, NEW.guardian_id,
          CASE WHEN NEW.status = 'boarded' THEN 'pupil_boarded' ELSE 'pupil_dropped_off' END, v_msg);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.pupil_bus_logs_after_insert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER pupil_bus_logs_after_insert
AFTER INSERT ON public.pupil_bus_logs
FOR EACH ROW EXECUTE FUNCTION public.pupil_bus_logs_after_insert();