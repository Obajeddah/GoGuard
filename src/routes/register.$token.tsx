import { useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Bell,
  BellOff,
  Bus,
  CheckCircle2,
  Copy,
  Loader2,
  Mail,
  Plus,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  getRegistrationOrg,
  MAX_CHILDREN_PER_REGISTRATION,
  submitRegistration,
} from "@/lib/registration.functions";
import { MAX_GUARDIANS, termsFor } from "@/lib/org-terms";
import { Field } from "@/components/auth-frame";
import { GateMark } from "@/components/brand";
import { PassCard, passUrl } from "@/components/pass-card";
import { PhotoPicker } from "@/components/photo-picker";
import { EmergencyLine } from "@/components/emergency-line";
import { ClassSelect } from "@/components/class-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/register/$token")({
  loader: async ({ params }) => {
    const org = await getRegistrationOrg({ data: { token: params.token } }).catch(() => null);
    if (!org) throw notFound();
    return { org };
  },
  head: ({ loaderData }) => {
    const name = loaderData?.org.name ?? "GoGuard";
    return {
      meta: [
        { title: `Guardian registration · ${name}` },
        {
          name: "description",
          content: `Register the people allowed to drop off and pick up your child at ${name}.`,
        },
        { property: "og:title", content: `Guardian registration · ${name}` },
        {
          property: "og:description",
          content: `Register the people allowed to drop off and pick up your child at ${name}.`,
        },
        { name: "robots", content: "noindex" },
      ],
    };
  },
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <div>
        <h1 className="text-2xl font-bold">This link is no longer active</h1>
        <p className="mt-2 text-muted-foreground">
          Please ask your school for the current registration link.
        </p>
      </div>
    </div>
  ),
  component: RegisterPage,
});

interface GuardianDraft {
  key: string;
  name: string;
  relationship: string;
  email: string;
  photo: string | null;
  receive_general_notifications: boolean;
}

const newGuardian = (n: number): GuardianDraft => ({
  key: `g${n}-${Date.now()}`,
  name: "",
  relationship: "",
  email: "",
  photo: null,
  receive_general_notifications: false,
});

interface ChildDraft {
  key: string;
  full_name: string;
  identifier_code: string;
  photo: string | null;
}

const newChild = (n: number): ChildDraft => ({
  key: `c${n}-${Date.now()}`,
  full_name: "",
  identifier_code: "",
  photo: null,
});

const emailOk = (v: string) => z.string().email().safeParse(v.trim()).success;

type Result = Awaited<ReturnType<typeof submitRegistration>>;

function RegisterPage() {
  const { org } = Route.useLoaderData();
  const { token } = Route.useParams();
  const terms = termsFor(org.type);
  const submit = useServerFn(submitRegistration);

  const [members, setMembers] = useState<ChildDraft[]>(() => [newChild(0)]);
  const [usesBus, setUsesBus] = useState(false);
  const [parent, setParent] = useState({
    name: "",
    email: "",
    phone: "",
    relationship: "",
    photo: null as string | null,
  });
  // The registering parent is Guardian 1, so this list holds only the extras.
  const [guardians, setGuardians] = useState<GuardianDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [honeypot, setHoneypot] = useState("");

  const updateG = (key: string, patch: Partial<GuardianDraft>) =>
    setGuardians((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));

  const updateC = (key: string, patch: Partial<ChildDraft>) =>
    setMembers((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  function validate() {
    const e: Record<string, string> = {};
    members.forEach((c, i) => {
      if (!c.full_name.trim())
        e[`m${i}_name`] =
          `Enter your ${org.type === "school" ? "child" : terms.member.toLowerCase()}'s full name`;
      if (org.classes.length && !c.identifier_code)
        e[`m${i}_class`] =
          `Choose ${terms.identifier.toLowerCase()} for this ${org.type === "school" ? "child" : terms.member.toLowerCase()}`;
      if (!c.photo)
        e[`m${i}_photo`] =
          "Add a clear photo of their face. The gate checks the picture before they are picked up.";
    });
    if (!parent.name.trim()) e["parent_name"] = "Enter your full name";
    if (!emailOk(parent.email)) e["parent_email"] = "Enter a valid email address";
    if (!parent.relationship.trim()) e["parent_rel"] = "Choose your relationship";
    if (!parent.photo)
      e["parent_photo"] = "Add a clear photo of your face. Guards use it to confirm who you are.";
    guardians.forEach((g, i) => {
      if (!g.name.trim()) e[`g${i}_name`] = "Enter their full name";
      if (!g.relationship.trim()) e[`g${i}_rel`] = "Choose or type a relationship";
      if (!emailOk(g.email)) e[`g${i}_email`] = "Enter a valid email address";
      if (!g.photo)
        e[`g${i}_photo`] =
          "Add a clear photo of their face. Guards use it to confirm who they are.";
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) {
      toast.error("Please check the highlighted fields.");
      return;
    }
    setBusy(true);
    try {
      const res = await submit({
        data: {
          token,
          website: honeypot,
          siteUrl: window.location.origin,
          members: members.map((c) => ({
            full_name: c.full_name,
            identifier_code: c.identifier_code,
            photo: c.photo!,
          })),
          uses_bus: org.transport && usesBus,
          parent,
          guardians: [
            {
              name: parent.name,
              relationship: parent.relationship,
              email: parent.email,
              photo: parent.photo!,
              receive_general_notifications: true,
            },
            ...guardians.map((g) => ({
              name: g.name,
              relationship: g.relationship,
              email: g.email,
              photo: g.photo!,
              receive_general_notifications: g.receive_general_notifications,
            })),
          ],
        },
      });
      setResult(res);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Registration didn't go through. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (result)
    return (
      <Success
        result={result}
        parentEmail={parent.email}
        photos={members.map(() => [parent.photo, ...guardians.map((g) => g.photo)])}
      />
    );

  return (
    <div className="min-h-screen pb-16">
      <header className="bg-gradient-ink px-4 pb-10 pt-6 text-ink-foreground">
        <div className="mx-auto max-w-xl">
          <div className="flex items-center gap-2.5">
            <GateMark className="size-7" />
            <div className="leading-tight">
              <p className="font-display font-semibold">
                {org.name}
                {org.branchName && (
                  <span className="font-normal text-ink-muted"> · {org.branchName}</span>
                )}
              </p>
              <p className="text-xs text-ink-muted">Secured by GoGuard</p>
            </div>
          </div>
          <h1 className="mt-6 text-3xl font-extrabold leading-tight">{terms.registerTitle}</h1>
          <p className="mt-2 text-ink-muted">{terms.registerIntro}</p>
          <p className="mt-3 text-sm text-ink-muted">
            Takes about five minutes. No app or account needed.
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="mx-auto -mt-5 max-w-xl space-y-5 px-4" noValidate>
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          className="hidden"
          aria-hidden
        />

        <Section
          step="1"
          title={org.type === "school" ? "Your children" : `${terms.member} details`}
          {...(members.length > 1 ? { aside: `${members.length} children` } : {})}
        >
          <p className="mb-4 text-sm text-muted-foreground">
            Add two or three children here only if the same people collect them and they ride the
            same school bus. If a child has a different {terms.guardian.toLowerCase()} or a
            different bus, register them separately with a new form.
          </p>
          <div className="space-y-4">
            {members.map((c, i) => (
              <div key={c.key} className="rounded-2xl border bg-background p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-display font-semibold">
                    {org.type === "school" ? "Child" : terms.member} {i + 1}
                  </p>
                  {members.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setMembers((cs) => cs.filter((x) => x.key !== c.key))}
                    >
                      <Trash2 /> Remove
                    </Button>
                  )}
                </div>
                <div className="flex gap-4">
                  <div className="shrink-0">
                    <PhotoPicker
                      value={c.photo}
                      onChange={(photo) => updateC(c.key, { photo })}
                      label="Face photo"
                      required
                    />
                    {errors[`m${i}_photo`] ? (
                      <p className="mt-1 w-24 text-center text-[11px] text-destructive">
                        {errors[`m${i}_photo`]}
                      </p>
                    ) : (
                      <p className="mt-1 w-24 text-center text-[11px] text-muted-foreground">
                        Picture needed
                      </p>
                    )}
                  </div>
                  <div className="flex-1 space-y-3">
                    <Field label="Full name" error={errors[`m${i}_name`]}>
                      <Input
                        value={c.full_name}
                        onChange={(e) => updateC(c.key, { full_name: e.target.value })}
                      />
                    </Field>
                    <Field label={terms.identifier} error={errors[`m${i}_class`]}>
                      {org.classes.length ? (
                        <ClassSelect
                          classes={org.classes}
                          value={c.identifier_code}
                          onChange={(identifier_code) => updateC(c.key, { identifier_code })}
                          placeholder={`Choose ${terms.identifier.toLowerCase()}`}
                        />
                      ) : (
                        <Input
                          value={c.identifier_code}
                          onChange={(e) => updateC(c.key, { identifier_code: e.target.value })}
                          placeholder={terms.identifierPlaceholder}
                        />
                      )}
                    </Field>
                  </div>
                </div>
              </div>
            ))}
            {members.length < MAX_CHILDREN_PER_REGISTRATION && (
              <Button
                type="button"
                variant="outline"
                className="w-full border-dashed"
                onClick={() => setMembers((cs) => [...cs, newChild(cs.length)])}
              >
                <Plus /> Add another child
              </Button>
            )}
          </div>
          {org.transport && (
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-muted p-3">
              <Switch checked={usesBus} onCheckedChange={setUsesBus} className="mt-0.5" />
              <span className="text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  <Bus className="size-4" />
                  {members.length > 1
                    ? "My children take the school bus"
                    : "My child takes the school bus"}
                </span>
                <span className="text-muted-foreground">
                  {usesBus
                    ? "You'll get an email when they board and get off the bus, and a link to see where the bus is."
                    : "Leave off if you drop off and pick up at the gate."}
                </span>
              </span>
            </label>
          )}
        </Section>

        <Section step="2" title="Your details" aside="Guardian 1">
          <p className="mb-4 text-sm text-muted-foreground">
            You are the first {terms.guardian.toLowerCase()}. Your pass is included, and you receive
            every gate update.
          </p>
          <div className="flex gap-4">
            <div>
              <PhotoPicker
                value={parent.photo}
                onChange={(photo) => setParent((p) => ({ ...p, photo }))}
                label="Your face photo"
                required
              />
              {errors["parent_photo"] && (
                <p className="mt-2 max-w-24 text-sm text-destructive">{errors["parent_photo"]}</p>
              )}
            </div>
            <div className="flex-1 space-y-3">
              <Field label="Your full name" error={errors["parent_name"]}>
                <Input
                  value={parent.name}
                  onChange={(e) => setParent((p) => ({ ...p, name: e.target.value }))}
                  autoComplete="name"
                />
              </Field>
              <Field
                label="Your email"
                error={errors["parent_email"]}
                hint={`You'll receive an email for every ${terms.checkInHint.toLowerCase()} and ${terms.checkOutHint.toLowerCase()}, whoever is at the gate.`}
              >
                <Input
                  type="email"
                  value={parent.email}
                  onChange={(e) => setParent((p) => ({ ...p, email: e.target.value }))}
                  autoComplete="email"
                />
              </Field>
              <Field label="Phone (optional)">
                <Input
                  type="tel"
                  value={parent.phone}
                  onChange={(e) => setParent((p) => ({ ...p, phone: e.target.value }))}
                  autoComplete="tel"
                />
              </Field>
            </div>
          </div>
          <div className="mt-4">
            <p className="mb-1.5 text-sm font-medium">
              Your relationship to{" "}
              {org.type === "school" ? "your child" : `the ${terms.member.toLowerCase()}`}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {terms.relationships.map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => setParent((p) => ({ ...p, relationship: r }))}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition",
                    parent.relationship === r
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <Input
              className="mt-2"
              placeholder="Other (please specify)"
              value={terms.relationships.includes(parent.relationship) ? "" : parent.relationship}
              onChange={(e) => setParent((p) => ({ ...p, relationship: e.target.value }))}
            />
            {errors["parent_rel"] && (
              <p className="mt-1 text-sm text-destructive">{errors["parent_rel"]}</p>
            )}
          </div>
        </Section>

        <Section
          step="3"
          title={`Other trusted ${terms.guardians.toLowerCase()}`}
          aside={`${guardians.length} of ${MAX_GUARDIANS - 1} added`}
        >
          <p className="mb-4 text-sm text-muted-foreground">
            You are already {terms.guardian.toLowerCase()} 1. Add up to {MAX_GUARDIANS - 1} more
            people you trust — {MAX_GUARDIANS} people in total.
          </p>
          <div className="space-y-4">
            {guardians.map((g, i) => (
              <div key={g.key} className="rounded-2xl border bg-background p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-display font-semibold">
                    {terms.guardian} {i + 2}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setGuardians((gs) => gs.filter((x) => x.key !== g.key))}
                  >
                    <Trash2 /> Remove
                  </Button>
                </div>
                <div className="flex gap-4">
                  <div>
                    <PhotoPicker
                      value={g.photo}
                      onChange={(photo) => updateG(g.key, { photo })}
                      label="Face photo"
                      required
                    />
                  </div>
                  <div className="flex-1 space-y-3">
                    <Field label="Full name" error={errors[`g${i}_name`]}>
                      <Input
                        value={g.name}
                        onChange={(e) => updateG(g.key, { name: e.target.value })}
                      />
                    </Field>
                    <Field label="Email" error={errors[`g${i}_email`]}>
                      <Input
                        type="email"
                        value={g.email}
                        onChange={(e) => updateG(g.key, { email: e.target.value })}
                      />
                    </Field>
                  </div>
                </div>
                {errors[`g${i}_photo`] && (
                  <p className="mt-2 text-sm text-destructive">{errors[`g${i}_photo`]}</p>
                )}

                <div className="mt-3">
                  <p className="mb-1.5 text-sm font-medium">Relationship</p>
                  <div className="flex flex-wrap gap-1.5">
                    {terms.relationships.map((r) => (
                      <button
                        type="button"
                        key={r}
                        onClick={() => updateG(g.key, { relationship: r })}
                        className={cn(
                          "rounded-full border px-3 py-1 text-sm transition",
                          g.relationship === r
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-card text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <Input
                    className="mt-2"
                    placeholder="Other (please specify)"
                    value={terms.relationships.includes(g.relationship) ? "" : g.relationship}
                    onChange={(e) => updateG(g.key, { relationship: e.target.value })}
                  />
                  {errors[`g${i}_rel`] && (
                    <p className="mt-1 text-sm text-destructive">{errors[`g${i}_rel`]}</p>
                  )}
                </div>

                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-muted p-3">
                  <Switch
                    checked={g.receive_general_notifications}
                    onCheckedChange={(v) => updateG(g.key, { receive_general_notifications: v })}
                    className="mt-0.5"
                  />
                  <span className="text-sm">
                    <span className="flex items-center gap-1.5 font-medium">
                      {g.receive_general_notifications ? (
                        <Bell className="size-4" />
                      ) : (
                        <BellOff className="size-4" />
                      )}
                      Send them every update
                    </span>
                    <span className="text-muted-foreground">
                      {g.receive_general_notifications
                        ? `Emailed for every ${terms.checkInHint.toLowerCase()} and ${terms.checkOutHint.toLowerCase()}, whoever is at the gate.`
                        : "Emailed only when their own pass is scanned."}
                    </span>
                  </span>
                </label>
              </div>
            ))}

            {guardians.length < MAX_GUARDIANS - 1 && (
              <Button
                type="button"
                variant="outline"
                className="w-full border-dashed"
                onClick={() => setGuardians((gs) => [...gs, newGuardian(gs.length)])}
              >
                <Plus /> Add another {terms.guardian.toLowerCase()}
              </Button>
            )}
          </div>
        </Section>

        <div className="rounded-2xl border border-signal/40 bg-signal/10 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Mail className="size-4" /> Who gets emailed
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              You receive every gate update, whichever {terms.guardian.toLowerCase()} is scanned.
            </li>
            <li>
              Each {terms.guardian.toLowerCase()} is always emailed when their own pass is scanned.
            </li>
            <li>
              Switch on "Send them every update" to keep a {terms.guardian.toLowerCase()} informed
              of everything.
            </li>
            {org.emergencyPhone && (
              <li>
                Every email includes {org.name}'s emergency line ({org.emergencyPhone}) in case
                anything is unexpected.
              </li>
            )}
          </ul>
        </div>

        <Button type="submit" variant="signal" size="lg" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Complete registration
        </Button>
      </form>
    </div>
  );
}

function Section({
  step,
  title,
  aside,
  children,
}: {
  step: string;
  title: string;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border bg-card p-5 shadow-soft">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex size-7 items-center justify-center rounded-full bg-ink font-mono text-xs text-ink-foreground">
          {step}
        </span>
        <h2 className="text-lg font-bold">{title}</h2>
        {aside && <span className="ml-auto font-mono text-xs text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Success({
  result,
  parentEmail,
  photos,
}: {
  result: Result;
  parentEmail: string;
  photos: (string | null)[][];
}) {
  const terms = termsFor(result.orgType);
  const totalPasses = result.members.reduce((n, m) => n + m.passes.length, 0);
  const names = result.members.map((m) => m.name).join(" and ");
  return (
    <div className="min-h-screen pb-16">
      <header className="bg-gradient-ink px-4 pb-10 pt-8 text-center text-ink-foreground">
        <CheckCircle2 className="animate-gate-pop mx-auto size-14 text-checkin" />
        <h1 className="mt-4 text-3xl font-extrabold">Registration complete</h1>
        <p className="mx-auto mt-2 max-w-md text-ink-muted">
          {totalPasses} {totalPasses === 1 ? "pass is" : "passes are"} ready for {names} at{" "}
          {result.orgName}.{" "}
          {result.passesEmailed > 0
            ? `Each ${terms.guardian.toLowerCase()} has been emailed their own pass and QR code.`
            : `Send each ${terms.guardian.toLowerCase()} their pass.`}{" "}
          They show the QR code to the guard at the gate.
        </p>
      </header>
      <div className="mx-auto -mt-4 max-w-xl space-y-8 px-4">
        {result.members.map((m, mi) => (
          <div key={m.id} className="space-y-6">
            {result.members.length > 1 && (
              <h2 className="font-display text-xl font-bold">{m.name}</h2>
            )}
            {m.passes.map((p, idx) => {
              const link = passUrl(p.hash);
              return (
                <div key={p.id} className="space-y-3">
                  <PassCard
                    hash={p.hash}
                    guardianName={p.name}
                    relationship={p.relationship}
                    memberName={m.name}
                    orgName={result.orgName}
                    photoUrl={photos[mi]?.[idx] ?? null}
                    guardianLabel={terms.guardian}
                  />
                  <div className="mx-auto flex max-w-sm gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={async () => {
                        await navigator.clipboard.writeText(link);
                        toast.success("Pass link copied");
                      }}
                    >
                      <Copy /> Copy link
                    </Button>
                    <Button asChild variant="ink" className="flex-1">
                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(
                          `Hello ${p.name}, you've been registered to drop off and pick up ${m.name} at ${result.orgName}. Show this pass to the guard at the gate: ${link}`,
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Share2 /> WhatsApp
                      </a>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <p className="text-center text-sm text-muted-foreground">
          {result.busTrackToken ? "Gate and bus updates" : "Gate updates"} will be sent to{" "}
          <span className="font-medium text-foreground">{parentEmail}</span>. You can close this
          page.
        </p>
        {result.emergencyPhone && (
          <EmergencyLine phone={result.emergencyPhone} orgName={result.orgName} />
        )}
      </div>
    </div>
  );
}
