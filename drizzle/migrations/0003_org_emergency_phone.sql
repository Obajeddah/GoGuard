ALTER TABLE public.organizations ADD COLUMN emergency_phone text CHECK (emergency_phone IS NULL OR char_length(emergency_phone) <= 30);
GRANT UPDATE (emergency_phone) ON public.organizations TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_org_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  v_type public.org_type;
  v_domain text := lower(split_part(NEW.email, '@', 2));
  v_org uuid;
  v_phone text := nullif(left(trim(coalesce(v_meta->>'emergency_phone', '')), 30), '');
BEGIN
  IF v_meta->>'signup_kind' IS DISTINCT FROM 'org_admin' THEN
    RETURN NEW;
  END IF;
  v_type := (v_meta->>'org_type')::public.org_type;
  IF coalesce(trim(v_meta->>'org_name'), '') = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;
  IF v_type = 'school' AND public.is_free_email_domain(v_domain) THEN
    RAISE EXCEPTION 'Schools must sign up with an official school domain email';
  END IF;
  INSERT INTO public.organizations (name, type, admin_email, email_domain, emergency_phone)
  VALUES (trim(v_meta->>'org_name'), v_type, NEW.email, v_domain, v_phone)
  RETURNING id INTO v_org;
  INSERT INTO public.profiles (id, org_id, full_name, email)
  VALUES (NEW.id, v_org, coalesce(v_meta->>'full_name', ''), NEW.email);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_org_admin() FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.get_registration_org(text);
CREATE FUNCTION public.get_registration_org(_token text)
RETURNS TABLE (id uuid, name text, type public.org_type, emergency_phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.name, o.type, o.emergency_phone FROM public.organizations o WHERE o.registration_token = _token
$$;
REVOKE ALL ON FUNCTION public.get_registration_org(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_registration_org(text) TO anon, authenticated, service_role;