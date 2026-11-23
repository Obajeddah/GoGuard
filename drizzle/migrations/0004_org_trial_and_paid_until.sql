ALTER TABLE public.organizations ADD COLUMN trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '14 days');
ALTER TABLE public.organizations ADD COLUMN paid_until timestamptz;
UPDATE public.organizations SET trial_ends_at = created_at + interval '14 days';
COMMENT ON COLUMN public.organizations.trial_ends_at IS 'End of the free trial (14 days from sign-up).';
COMMENT ON COLUMN public.organizations.paid_until IS 'Access paid through this time; set only by the payment webhook (service role).';