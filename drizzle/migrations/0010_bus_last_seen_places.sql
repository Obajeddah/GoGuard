-- Area names for "Last seen at ..." on the parent bus page, cached per ~100 m square
-- so the map service is asked at most once per area.
CREATE TABLE public.place_names (
  lat_key numeric(7,3) NOT NULL,
  lng_key numeric(7,3) NOT NULL,
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lat_key, lng_key)
);
GRANT ALL ON public.place_names TO service_role;
ALTER TABLE public.place_names ENABLE ROW LEVEL SECURITY;

-- Ride update wording: a morning drop-off means the pupil arrived at school.
CREATE OR REPLACE FUNCTION public.pupil_bus_logs_after_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_bus_id uuid;
  v_bus text;
  v_dir text;
  v_time text;
  v_msg text;
BEGIN
  SELECT m.full_name INTO v_name FROM public.members m WHERE m.id = NEW.member_id;
  SELECT t.bus_id, b.bus_number, t.direction INTO v_bus_id, v_bus, v_dir
  FROM public.bus_trips t JOIN public.buses b ON b.id = t.bus_id
  WHERE t.id = NEW.trip_id;
  v_time := to_char(NEW."timestamp" AT TIME ZONE 'Africa/Lagos', 'FMHH12:MI AM');
  IF NEW.status = 'boarded' THEN
    v_msg := v_name || ' boarded Bus ' || v_bus || ' at ' || v_time || '.';
  ELSIF v_dir = 'to_school' THEN
    v_msg := v_name || ' arrived at school on Bus ' || v_bus || ' at ' || v_time || '.';
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