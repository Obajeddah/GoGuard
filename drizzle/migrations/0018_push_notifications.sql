-- Push notifications for Parent PWA

-- Table to store push subscriptions per parent_link_token
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_link_token uuid NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX push_subscriptions_parent_link_idx ON public.push_subscriptions(parent_link_token);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Parents can manage their own subscriptions
CREATE POLICY "Parent manages own push subscriptions" ON public.push_subscriptions
FOR ALL TO authenticated
USING (
  parent_link_token IN (
    SELECT parent_link_token FROM public.members WHERE primary_email = auth.email()
  )
)
WITH CHECK (
  parent_link_token IN (
    SELECT parent_link_token FROM public.members WHERE primary_email = auth.email()
  )
);

-- Service role manages all
CREATE POLICY "Service role manages push subscriptions" ON public.push_subscriptions
FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Add VAPID public key to org settings (optional, can use env var instead)
-- COMMENT ON TABLE public.organizations IS 'VAPID_PUBLIC_KEY stored in env';
