-- Strict passes: a pass belongs to one guardian, one child and one photo.
CREATE OR REPLACE FUNCTION public.guardians_pass_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.unique_qr_hash := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    RETURN NEW;
  END IF;
  IF NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.name IS DISTINCT FROM OLD.name
     OR (OLD.photo_path IS NOT NULL AND NEW.photo_path IS DISTINCT FROM OLD.photo_path) THEN
    NEW.unique_qr_hash := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  ELSE
    NEW.unique_qr_hash := OLD.unique_qr_hash;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guardians_pass_binding() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guardians_pass_binding
BEFORE INSERT OR UPDATE ON public.guardians
FOR EACH ROW EXECUTE FUNCTION public.guardians_pass_binding();

-- Transport package
ALTER TABLE public.organizations ADD COLUMN transport_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE public.buses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bus_number text NOT NULL,
  plate_number text NOT NULL,
  route_axis text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, bus_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.buses TO authenticated;
GRANT ALL ON public.buses TO service_role;
ALTER TABLE public.buses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org users view buses" ON public.buses FOR SELECT TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "Admins insert buses" ON public.buses FOR INSERT TO authenticated
WITH CHECK (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update buses" ON public.buses FOR UPDATE TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete buses" ON public.buses FOR DELETE TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.members ADD COLUMN bus_id uuid REFERENCES public.buses(id) ON DELETE SET NULL;
CREATE INDEX members_bus_id_idx ON public.members(bus_id);

CREATE TABLE public.bus_crew (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bus_id uuid NOT NULL UNIQUE REFERENCES public.buses(id) ON DELETE CASCADE,
  driver_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  attendant_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  active_date date NOT NULL DEFAULT current_date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bus_crew TO authenticated;
GRANT ALL ON public.bus_crew TO service_role;
ALTER TABLE public.bus_crew ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org users view bus crew" ON public.bus_crew FOR SELECT TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "Admins insert bus crew" ON public.bus_crew FOR INSERT TO authenticated
WITH CHECK (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update bus crew" ON public.bus_crew FOR UPDATE TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete bus crew" ON public.bus_crew FOR DELETE TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.bus_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bus_id uuid NOT NULL REFERENCES public.buses(id) ON DELETE CASCADE,
  direction text NOT NULL DEFAULT 'to_school' CHECK (direction IN ('to_school', 'to_home')),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_transit', 'completed')),
  current_lat double precision,
  current_lng double precision,
  current_speed double precision,
  current_heading double precision,
  last_ping_at timestamptz,
  started_by uuid,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bus_trips_one_active ON public.bus_trips(bus_id) WHERE status = 'in_transit';
CREATE INDEX bus_trips_org_status_idx ON public.bus_trips(org_id, status);
GRANT SELECT, INSERT, UPDATE ON public.bus_trips TO authenticated;
GRANT ALL ON public.bus_trips TO service_role;

CREATE TABLE public.pupil_bus_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES public.bus_trips(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('boarded', 'dropped_off')),
  guardian_id uuid REFERENCES public.guardians(id) ON DELETE SET NULL,
  guardian_name text,
  recorded_by uuid NOT NULL,
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  lat double precision,
  lng double precision,
  client_id text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text
);
CREATE INDEX pupil_bus_logs_trip_idx ON public.pupil_bus_logs(trip_id, "timestamp");
GRANT SELECT, INSERT ON public.pupil_bus_logs TO authenticated;
GRANT ALL ON public.pupil_bus_logs TO service_role;

CREATE TABLE public.bus_trip_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES public.bus_trips(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  speed double precision,
  heading double precision,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  client_id text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text
);
CREATE INDEX bus_trip_points_trip_idx ON public.bus_trip_points(trip_id, recorded_at);
GRANT SELECT, INSERT ON public.bus_trip_points TO authenticated;
GRANT ALL ON public.bus_trip_points TO service_role;

CREATE TABLE public.transport_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bus_id uuid REFERENCES public.buses(id) ON DELETE CASCADE,
  kind text NOT NULL,
  message text NOT NULL,
  emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.transport_notices TO authenticated;
GRANT ALL ON public.transport_notices TO service_role;
ALTER TABLE public.transport_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view transport notices" ON public.transport_notices FOR SELECT TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

-- Helpers
CREATE OR REPLACE FUNCTION public.is_bus_crew(_user_id uuid, _bus_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bus_crew
    WHERE bus_id = _bus_id AND (driver_profile_id = _user_id OR attendant_profile_id = _user_id)
  )
$$;
CREATE OR REPLACE FUNCTION public.can_operate_trip(_user_id uuid, _trip_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bus_trips t
    WHERE t.id = _trip_id
      AND t.org_id = public.get_user_org_id(_user_id)
      AND (public.is_bus_crew(_user_id, t.bus_id) OR public.has_role(_user_id, 'admin'))
  )
$$;
REVOKE EXECUTE ON FUNCTION public.is_bus_crew(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_operate_trip(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_bus_crew(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_operate_trip(uuid, uuid) TO authenticated, service_role;

ALTER TABLE public.bus_trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org users view bus trips" ON public.bus_trips FOR SELECT TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "Crew start bus trips" ON public.bus_trips FOR INSERT TO authenticated
WITH CHECK (
  org_id = public.get_user_org_id(auth.uid())
  AND (public.is_bus_crew(auth.uid(), bus_id) OR public.has_role(auth.uid(), 'admin'))
);
CREATE POLICY "Crew update bus trips" ON public.bus_trips FOR UPDATE TO authenticated
USING (
  org_id = public.get_user_org_id(auth.uid())
  AND (public.is_bus_crew(auth.uid(), bus_id) OR public.has_role(auth.uid(), 'admin'))
)
WITH CHECK (
  org_id = public.get_user_org_id(auth.uid())
  AND (public.is_bus_crew(auth.uid(), bus_id) OR public.has_role(auth.uid(), 'admin'))
);

ALTER TABLE public.pupil_bus_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org users view pupil bus logs" ON public.pupil_bus_logs FOR SELECT TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "Crew record pupil bus logs" ON public.pupil_bus_logs FOR INSERT TO authenticated
WITH CHECK (recorded_by = auth.uid() AND public.can_operate_trip(auth.uid(), trip_id));

ALTER TABLE public.bus_trip_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org users view bus trip points" ON public.bus_trip_points FOR SELECT TO authenticated
USING (org_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "Crew record bus trip points" ON public.bus_trip_points FOR INSERT TO authenticated
WITH CHECK (public.can_operate_trip(auth.uid(), trip_id));

-- Triggers
CREATE OR REPLACE FUNCTION public.bus_crew_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM public.buses WHERE id = NEW.bus_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Bus not found'; END IF;
  NEW.org_id := v_org;
  IF NEW.driver_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.user_roles r ON r.user_id = p.id
    WHERE p.id = NEW.driver_profile_id AND p.org_id = v_org AND r.role = 'driver'
  ) THEN RAISE EXCEPTION 'Driver must be a driver account in this school'; END IF;
  IF NEW.attendant_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.user_roles r ON r.user_id = p.id
    WHERE p.id = NEW.attendant_profile_id AND p.org_id = v_org AND r.role = 'attendant'
  ) THEN RAISE EXCEPTION 'Attendant must be an attendant account in this school'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.driver_profile_id IS DISTINCT FROM OLD.driver_profile_id
     OR NEW.attendant_profile_id IS DISTINCT FROM OLD.attendant_profile_id) THEN
    NEW.active_date := current_date;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER bus_crew_before_write
BEFORE INSERT OR UPDATE ON public.bus_crew
FOR EACH ROW EXECUTE FUNCTION public.bus_crew_before_write();

CREATE OR REPLACE FUNCTION public.bus_crew_after_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bus text;
  v_parts text[] := '{}';
BEGIN
  SELECT bus_number INTO v_bus FROM public.buses WHERE id = NEW.bus_id;
  IF NEW.driver_profile_id IS DISTINCT FROM OLD.driver_profile_id THEN
    v_parts := v_parts || ('Driver: ' || COALESCE((SELECT full_name FROM public.profiles WHERE id = NEW.driver_profile_id), 'not assigned'));
  END IF;
  IF NEW.attendant_profile_id IS DISTINCT FROM OLD.attendant_profile_id THEN
    v_parts := v_parts || ('Attendant: ' || COALESCE((SELECT full_name FROM public.profiles WHERE id = NEW.attendant_profile_id), 'not assigned'));
  END IF;
  IF array_length(v_parts, 1) > 0 THEN
    INSERT INTO public.transport_notices (org_id, bus_id, kind, message)
    VALUES (NEW.org_id, NEW.bus_id, 'crew_change',
      'Driver/Attendant update for Bus ' || COALESCE(v_bus, '') || ': ' || array_to_string(v_parts, ', '));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bus_crew_after_change
AFTER UPDATE ON public.bus_crew
FOR EACH ROW EXECUTE FUNCTION public.bus_crew_after_change();

CREATE OR REPLACE FUNCTION public.bus_trips_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM public.buses WHERE id = NEW.bus_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Bus not found'; END IF;
  NEW.org_id := v_org;
  IF TG_OP = 'UPDATE' THEN
    NEW.bus_id := OLD.bus_id;
    NEW.org_id := OLD.org_id;
    NEW.direction := OLD.direction;
    IF OLD.status = 'completed' THEN
      NEW.status := 'completed';
    END IF;
  END IF;
  IF NEW.status = 'in_transit' AND NEW.started_at IS NULL THEN NEW.started_at := now(); END IF;
  IF NEW.started_at IS NOT NULL AND NEW.started_at > now() THEN NEW.started_at := now(); END IF;
  IF NEW.status = 'completed' AND NEW.ended_at IS NULL THEN NEW.ended_at := now(); END IF;
  IF NEW.ended_at IS NOT NULL AND NEW.ended_at > now() THEN NEW.ended_at := now(); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bus_trips_before_write
BEFORE INSERT OR UPDATE ON public.bus_trips
FOR EACH ROW EXECUTE FUNCTION public.bus_trips_before_write();

CREATE OR REPLACE FUNCTION public.pupil_bus_logs_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip record;
  v_member record;
  v_guardian record;
BEGIN
  SELECT id, org_id, bus_id, status INTO v_trip FROM public.bus_trips WHERE id = NEW.trip_id;
  IF v_trip.id IS NULL OR v_trip.status = 'scheduled' THEN RAISE EXCEPTION 'This ride has not started'; END IF;
  SELECT id, org_id, bus_id INTO v_member FROM public.members WHERE id = NEW.member_id;
  IF v_member.id IS NULL OR v_member.org_id <> v_trip.org_id OR v_member.bus_id IS DISTINCT FROM v_trip.bus_id THEN
    RAISE EXCEPTION 'This pupil is not on this bus';
  END IF;
  NEW.org_id := v_trip.org_id;
  IF NEW.guardian_id IS NOT NULL THEN
    SELECT id, member_id, name INTO v_guardian FROM public.guardians WHERE id = NEW.guardian_id;
    IF v_guardian.id IS NULL OR v_guardian.member_id <> NEW.member_id THEN
      RAISE EXCEPTION 'Guardian is not authorized for this pupil';
    END IF;
    NEW.guardian_name := v_guardian.name;
  ELSE
    NEW.guardian_name := NULL;
  END IF;
  IF NEW."timestamp" IS NULL OR NEW."timestamp" > now() THEN NEW."timestamp" := now(); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pupil_bus_logs_before_insert
BEFORE INSERT ON public.pupil_bus_logs
FOR EACH ROW EXECUTE FUNCTION public.pupil_bus_logs_before_insert();

CREATE OR REPLACE FUNCTION public.bus_trip_points_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM public.bus_trips WHERE id = NEW.trip_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Trip not found'; END IF;
  NEW.org_id := v_org;
  IF NEW.recorded_at IS NULL OR NEW.recorded_at > now() THEN NEW.recorded_at := now(); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bus_trip_points_before_insert
BEFORE INSERT ON public.bus_trip_points
FOR EACH ROW EXECUTE FUNCTION public.bus_trip_points_before_insert();

CREATE OR REPLACE FUNCTION public.bus_trip_points_after_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.bus_trips
  SET current_lat = NEW.lat, current_lng = NEW.lng, current_speed = NEW.speed,
      current_heading = NEW.heading, last_ping_at = NEW.recorded_at
  WHERE id = NEW.trip_id AND (last_ping_at IS NULL OR last_ping_at < NEW.recorded_at);
  RETURN NEW;
END;
$$;
CREATE TRIGGER bus_trip_points_after_insert
AFTER INSERT ON public.bus_trip_points
FOR EACH ROW EXECUTE FUNCTION public.bus_trip_points_after_insert();

REVOKE EXECUTE ON FUNCTION public.bus_crew_before_write() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bus_crew_after_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bus_trips_before_write() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pupil_bus_logs_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bus_trip_points_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bus_trip_points_after_insert() FROM PUBLIC, anon, authenticated;