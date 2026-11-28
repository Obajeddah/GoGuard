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
import { saveOrgEmergencyLine } from "@/lib/org-contact.functions";
import { format } from "date-fns";
import { Field } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { MAX_CLASSES, normaliseClasses, PRESET_CLASSES } from "@/lib/classes";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings · GoGuard" },
      {
        name: "description",
        content: "Manage your organisation profile, emergency line and gate staff accounts.",
      },
      { property: "og:title", content: "Settings · GoGuard" },
      {
        property: "og:description",
        content: "Manage your organisation profile, emergency line and gate staff accounts.",
      },
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
        <p className="text-muted-foreground">
          Your organisation profile and the people who run the gate.
        </p>
      </div>
      <OrgProfile />
      <Classes />
      <ParentAppSettings />
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

  const saveEmergencyLine = useServerFn(saveOrgEmergencyLine);
  const save = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2) throw new Error("Enter your organisation's name.");
      const { error } = await supabase
        .from("organizations")
        .update({ name: name.trim() })
        .eq("id", org.id);
      if (error) throw new Error("Couldn't save your changes. Please try again.");
      // The line is encrypted server-side, so it never travels to the database
      // as plain text from the browser.
      await saveEmergencyLine({ data: { phone: phone.trim() } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("Profile updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save your changes."),
  });

  const dirty =
    name.trim() !== org.name || (phone.trim() || null) !== (org.emergency_phone ?? null);

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
              <PhoneCall className="size-4" /> Add an emergency line before sharing your
              registration link.
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

function ParentAppSettings() {
  const { data: me } = useMe();
  const org = me!.org!;
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["parent-app-settings", org.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", org.id)
        .maybeSingle();
      const row = data as unknown as {
        allow_parent_calls?: boolean | null;
        school_closes_at?: string | null;
        school_calendar?: {
          parent_app?: { allow_driver_calls?: boolean; allow_attendant_calls?: boolean };
        } | null;
      } | null;
      // The two switches are kept in the settings block every school already
      // has, so turning a call button off saves and reaches the parent app
      // straight away.
      const savedCalls = row?.school_calendar?.parent_app;
      const callsOn = row?.allow_parent_calls !== false;
      return {
        allowDriver: savedCalls?.allow_driver_calls ?? callsOn,
        allowAttendant: savedCalls?.allow_attendant_calls ?? callsOn,
        closesAt: (row?.school_closes_at ?? "15:00").slice(0, 5),
        calendar: row?.school_calendar ?? {},
        available: row?.school_calendar != null,
      };
    },
  });

  const [allowDriver, setAllowDriver] = useState(true);
  const [allowAttendant, setAllowAttendant] = useState(true);
  const [closesAt, setClosesAt] = useState("15:00");
  useEffect(() => {
    if (!settings.data) return;
    setAllowDriver(settings.data.allowDriver);
    setAllowAttendant(settings.data.allowAttendant);
    setClosesAt(settings.data.closesAt);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => {
      const calendar = (settings.data?.calendar ?? {}) as Record<string, unknown>;
      const { error } = await supabase
        .from("organizations")
        .update({
          allow_parent_calls: allowDriver || allowAttendant,
          school_closes_at: closesAt,
          school_calendar: {
            ...calendar,
            parent_app: {
              allow_driver_calls: allowDriver,
              allow_attendant_calls: allowAttendant,
            },
          },
        } as never)
        .eq("id", org.id);
      if (error) throw new Error("Couldn't save these settings. Please try again.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["parent-app-settings"] });
      toast.success("Parent app settings saved");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Couldn't save these settings. Please try again."),
  });

  return (
    <section className="rounded-3xl border bg-card p-5 sm:p-6">
      <h2 className="text-lg font-bold">Parent app</h2>
      <p className="text-sm text-muted-foreground">
        What parents can do from their own screen, and when the school day ends.
      </p>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl bg-muted/60 p-4">
        <Checkbox
          checked={allowDriver}
          onCheckedChange={(v) => setAllowDriver(v === true)}
          className="mt-0.5 size-5"
        />
        <span className="text-sm">
          <span className="block font-medium">Let parents call the driver</span>
          <span className="text-muted-foreground">
            Shows a call button for the bus driver on the parent app.
          </span>
        </span>
      </label>

      <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-2xl bg-muted/60 p-4">
        <Checkbox
          checked={allowAttendant}
          onCheckedChange={(v) => setAllowAttendant(v === true)}
          className="mt-0.5 size-5"
        />
        <span className="text-sm">
          <span className="block font-medium">Let parents call the attendant</span>
          <span className="text-muted-foreground">
            Shows a call button for the bus attendant on the parent app.
          </span>
        </span>
      </label>

      <div className="mt-4 max-w-xs space-y-1.5">
        <Field label="School closes at">
          <Input
            type="time"
            value={closesAt}
            onChange={(e) => e.target.value && setClosesAt(e.target.value)}
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          If a pupil is still at school, parents get one warning 30 minutes after this time and one
          an hour after, then no more.
        </p>
      </div>

      {!settings.data?.available && (
        <p className="mt-4 rounded-xl bg-signal/15 p-3 text-sm">
          One-time setup is still needed before these settings can be saved. Until then parents can
          call the crew and the school day is treated as ending at 15:00.
        </p>
      )}

      <Button
        className="mt-4"
        variant="signal"
        disabled={save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending && <Loader2 className="animate-spin" />} Save parent app settings
      </Button>
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
    setList((l) =>
      on ? normaliseClasses([...l, c]) : l.filter((x) => x.toLowerCase() !== c.toLowerCase()),
    );
  const customs = list.filter(
    (c) => !PRESET_CLASSES.some((p) => p.toLowerCase() === c.toLowerCase()),
  );
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
            <Checkbox
              checked={has(c)}
              onCheckedChange={(v) => toggle(c, v === true)}
              className="size-5"
            />
            {c}
          </label>
        ))}
      </div>
      {customs.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {customs.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 rounded-full bg-accent py-1 pl-3 pr-1 text-sm text-accent-foreground"
            >
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
          <p className="text-sm text-muted-foreground">
            Until you save classes, parents type their child's class.
          </p>
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
  const text =
    state.transportActive && org.paid_until
      ? `Transport plan active until ${format(new Date(org.paid_until), "d MMMM yyyy")}.`
      : "Upgrade to paid plan to unlock Transport & Multi-Branch features.";
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <p
        className={
          state.transportActive
            ? "text-sm text-muted-foreground"
            : "text-sm font-medium text-destructive"
        }
      >
        {text}
      </p>
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
        <p
          className={
            state.status === "expired" ? "font-medium text-destructive" : "text-muted-foreground"
          }
        >
          {summary}
        </p>
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
      <p className="text-sm text-muted-foreground">
        Card, bank transfer or USSD, through Paystack.
      </p>
    </section>
  );
}
