import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PhoneCall, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useMe, type Me } from "@/hooks/use-me";
import { termsFor } from "@/lib/org-terms";
import { GateStaff } from "@/components/gate-staff";
import { SchoolSecurity } from "@/components/school-security";
import { AppShell } from "@/components/app-shell";
import { PlanCards } from "@/components/plan-cards";
import { billingState, type PlanId } from "@/lib/billing";
import { startCheckout } from "@/lib/payment.functions";
import { format } from "date-fns";
import { Field } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { MAX_CLASSES, normaliseClasses, PRESET_CLASSES } from "@/lib/classes";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — GoGuard" },
      { name: "description", content: "Manage your organisation profile, emergency line and gate staff accounts." },
      { property: "og:title", content: "Settings — GoGuard" },
      { property: "og:description", content: "Manage your organisation profile, emergency line and gate staff accounts." },
    ],
  }),
  component: () => (
    <AppShell adminOnly>
      <SettingsPage />
    </AppShell>
  ),
});

function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Your organisation profile and the people who run the gate.</p>
      </div>
      <OrgProfile />
      <Classes />
      <Transport />
      <Billing />
      <SchoolSecurity />
      <GateStaff />
    </div>
  );
}

function OrgProfile() {
  const { data: me } = useMe();
  const org = me!.org!;
  const terms = termsFor(org.type);
  const queryClient = useQueryClient();
  const [name, setName] = useState(org.name);
  const [phone, setPhone] = useState(org.emergency_phone ?? "");
  useEffect(() => {
    setName(org.name);
    setPhone(org.emergency_phone ?? "");
  }, [org.name, org.emergency_phone]);

  const save = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2) throw new Error("Enter your organisation's name.");
      const { error } = await supabase
        .from("organizations")
        .update({ name: name.trim(), emergency_phone: phone.trim() || null })
        .eq("id", org.id);
      if (error) throw new Error("Couldn't save your changes. Please try again.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("Profile updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save your changes."),
  });

  const dirty = name.trim() !== org.name || (phone.trim() || null) !== (org.emergency_phone ?? null);

  return (
    <section className="rounded-3xl border bg-card p-5 sm:p-6">
      <h2 className="text-lg font-bold">{terms.label} profile</h2>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label={`${terms.label} name`}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field
          label="Emergency line"
          hint={`Included in every gate email so ${terms.owner.toLowerCase()}s can reach you about an unexpected ${terms.checkOutHint.toLowerCase()} or ${terms.checkInHint.toLowerCase()}.`}
        >
          <Input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+234 801 234 5678"
            maxLength={30}
          />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={!dirty || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} Save changes
          </Button>
          {!org.emergency_phone && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <PhoneCall className="size-4" /> Add an emergency line before sharing your registration link.
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

function Classes() {
  const { data: me } = useMe();
  const org = me!.org!;
  const queryClient = useQueryClient();
  const saved = org.classes ?? [];
  const [list, setList] = useState<string[]>(saved);
  const [custom, setCustom] = useState("");
  useEffect(() => setList(org.classes ?? []), [org.classes]);

  const has = (c: string) => list.some((x) => x.toLowerCase() === c.toLowerCase());
  const toggle = (c: string, on: boolean) =>
    setList((l) => (on ? normaliseClasses([...l, c]) : l.filter((x) => x.toLowerCase() !== c.toLowerCase())));
  const customs = list.filter((c) => !PRESET_CLASSES.some((p) => p.toLowerCase() === c.toLowerCase()));
  const dirty = JSON.stringify(normaliseClasses(list)) !== JSON.stringify(saved);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("organizations")
        .update({ classes: normaliseClasses(list) })
        .eq("id", org.id);
      if (error) throw new Error("Couldn't save your classes. Please try again.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("Classes saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save your classes."),
  });

  const addCustom = () => {
    const c = custom.trim();
    if (!c) return;
    if (list.length >= MAX_CLASSES) {
      toast.error(`You can add up to ${MAX_CLASSES} classes.`);
      return;
    }
    setList((l) => normaliseClasses([...l, c]));
    setCustom("");
  };

  return (
    <section className="rounded-3xl border bg-card p-5 sm:p-6">
      <h2 className="text-lg font-bold">Classes</h2>
      <p className="text-sm text-muted-foreground">
        Tick the classes your school offers. Parents choose one when they register.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {PRESET_CLASSES.map((c) => (
          <label key={c} className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox checked={has(c)} onCheckedChange={(v) => toggle(c, v === true)} className="size-5" />
            {c}
          </label>
        ))}
      </div>
      {customs.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {customs.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-accent py-1 pl-3 pr-1 text-sm text-accent-foreground">
              {c}
              <button
                type="button"
                aria-label={`Remove ${c}`}
                className="rounded-full p-0.5 hover:bg-background/60"
                onClick={() => toggle(c, false)}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addCustom();
        }}
      >
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Add your own, e.g. Primary 3A"
          maxLength={40}
          className="max-w-xs"
        />
        <Button type="submit" variant="outline" disabled={!custom.trim()}>
          <Plus /> Add
        </Button>
      </form>
      <div className="mt-5 flex items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />} Save classes
        </Button>
        {saved.length === 0 && (
          <p className="text-sm text-muted-foreground">Until you save classes, parents type their child's class.</p>
        )}
      </div>
    </section>
  );
}

function Transport() {
  const { data: me } = useMe();
  const org = me?.org;
  if (!org) return null;
  return (
    <section className="rounded-3xl border bg-card p-5 sm:p-6">
      <h2 className="text-lg font-bold">Transport</h2>
      <TransportStatus org={org} />
    </section>
  );
}

function TransportStatus({ org }: { org: NonNullable<Me["org"]> }) {
  const state = billingState(org);
  const text = state.transportActive && org.paid_until
    ? `Transport plan active until ${format(new Date(org.paid_until), "d MMMM yyyy")}.`
    : "Upgrade to paid plan to unlock Transport & Multi-Branch features.";
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <p className={state.transportActive ? "text-sm text-muted-foreground" : "text-sm font-medium text-destructive"}>{text}</p>
      {state.transportActive ? (
        <Button asChild variant="outline">
          <Link to="/fleet">Open Fleet</Link>
        </Button>
      ) : (
        <Button asChild variant="signal">
          <Link to="/settings" hash="billing">
            Choose a plan
          </Link>
        </Button>
      )}
    </div>
  );
}

function Billing() {
  const { data: me } = useMe();
  const org = me!.org!;
  const state = billingState(org);
  const start = useServerFn(startCheckout);
  const [busy, setBusy] = useState<PlanId | null>(null);

  const pay = async (plan: PlanId) => {
    setBusy(plan);
    try {
      const res = await start({ data: { plan } });
      if ("url" in res) {
        window.location.href = res.url;
        return;
      }
      toast.error(res.error);
    } catch {
      toast.error("Couldn't start the payment. Please try again.");
    }
    setBusy(null);
  };

  const summary =
    state.status === "active"
      ? `Your subscription is active until ${format(new Date(org.paid_until!), "d MMMM yyyy")}.`
      : state.status === "trial"
        ? `Your free trial ends on ${format(new Date(org.trial_ends_at), "d MMMM yyyy")} (${state.daysLeft} ${state.daysLeft === 1 ? "day" : "days"} left). Paying now adds to the end of your trial.`
        : "Your free trial has ended. Parent emails and spreadsheet downloads are paused until you subscribe.";
  return (
    <section id="billing" className="scroll-mt-24 space-y-4">
      <div>
        <h2 className="text-xl font-bold">Plan and billing</h2>
        <p className={state.status === "expired" ? "font-medium text-destructive" : "text-muted-foreground"}>{summary}</p>
      </div>
      <PlanCards
        action={(id) => (
          <Button
            variant={id === "group" ? "signal" : "default"}
            size="lg"
            className="w-full"
            disabled={busy !== null}
            onClick={() => pay(id)}
          >
            {busy === id && <Loader2 className="animate-spin" />}
            {state.status === "active" ? "Extend with this plan" : "Pay with Paystack"}
          </Button>
        )}
      />
      <p className="text-sm text-muted-foreground">Card, bank transfer or USSD, through Paystack.</p>
    </section>
  );
}

