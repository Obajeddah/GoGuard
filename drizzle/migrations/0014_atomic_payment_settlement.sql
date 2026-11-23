CREATE OR REPLACE FUNCTION public.settle_paystack_payment(_reference text, _amount_kobo integer, _currency text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.payments%ROWTYPE; o public.organizations%ROWTYPE; target text; months integer := 1; base timestamptz := now(); until_at timestamptz;
BEGIN
 SELECT * INTO p FROM public.payments WHERE reference = _reference FOR UPDATE;
 IF NOT FOUND THEN RETURN 'unknown'; END IF;
 IF _currency <> 'NGN' OR _amount_kobo IS DISTINCT FROM p.amount_kobo THEN RETURN 'mismatch'; END IF;
 IF p.status = 'success' THEN RETURN 'already'; END IF;
 IF p.status <> 'pending' THEN RETURN 'unknown'; END IF;
 SELECT * INTO o FROM public.organizations WHERE id = p.org_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'School not found for payment'; END IF;
 target := CASE p.plan WHEN 'monthly' THEN 'basic' WHEN 'yearly' THEN 'basic' WHEN 'transport' THEN 'standard' WHEN 'session' THEN 'standard' ELSE p.plan END;
 IF target NOT IN ('basic', 'standard', 'group') THEN RAISE EXCEPTION 'Unknown payment plan'; END IF;
 IF p.plan IN ('yearly', 'session') THEN months := 12; END IF;
 IF o.plan = target AND o.paid_until > now() THEN base := o.paid_until; END IF;
 IF target = 'basic' AND (o.plan = target OR o.paid_until IS NULL OR o.paid_until <= now()) THEN base := greatest(base, o.trial_ends_at); END IF;
 until_at := (base AT TIME ZONE 'UTC' + make_interval(months => months)) AT TIME ZONE 'UTC';
 UPDATE public.organizations SET plan = target, paid_until = until_at WHERE id = o.id;
 UPDATE public.payments SET status = 'success', paid_at = now() WHERE id = p.id;
 RETURN 'settled';
END; $$;
REVOKE ALL ON FUNCTION public.settle_paystack_payment(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_paystack_payment(text, integer, text) TO service_role;