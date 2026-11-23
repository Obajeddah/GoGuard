ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS classes text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.get_registration_classes(_token text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT classes FROM public.organizations WHERE registration_token = _token LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_registration_classes(text) TO anon, authenticated;