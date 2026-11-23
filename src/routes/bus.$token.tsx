import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Bus, CheckCircle2, Clock, MapPin, PhoneCall, UserRound } from "lucide-react";

import { getBusTracking } from "@/lib/bus-track.functions";
import { DIRECTION_LABEL, lastSeenText } from "@/lib/bus";
import { telHref } from "@/lib/ride-email";
import { GateMark } from "@/components/brand";
import { cn } from "@/lib/utils";

const trackingQuery = (token: string) =>
  queryOptions({
    queryKey: ["bus-track", token],
    queryFn: () => getBusTracking({ data: { token } }),
    // Poll faster while a fresh location has been asked of the bus.
    refetchInterval: (q) => (q.state.data?.lastSeen?.updating ? 8_000 : 20_000),
  });

export const Route = createFileRoute("/bus/$token")({
  loader: async ({ params, context }) => {
    const t = await context.queryClient.ensureQueryData(trackingQuery(params.token)).catch(() => null);
    if (!t) throw notFound();
    return null;
  },
  head: () => ({
    meta: [
      { title: "Where is my child? — GoGuard" },
      { name: "description", content: "Your child's school bus status and where the bus was last seen." },
      { property: "og:title", content: "Where is my child? — GoGuard" },
      { property: "og:description", content: "Your child's school bus status and where the bus was last seen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <div>
        <h1 className="text-2xl font-bold">This bus link isn't active</h1>
        <p className="mt-2 text-muted-foreground">Please contact the school.</p>
      </div>
    </div>
  ),
  component: BusTrackPage,
});

function BusTrackPage() {
  const { token } = Route.useParams();
  const { data: t, dataUpdatedAt } = useSuspenseQuery(trackingQuery(token));
  if (!t)
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-bold">This bus link isn't active</h1>
      </div>
    );

  const at = (iso: string) => format(new Date(iso), "h:mm a");
  const status = !t.bus
    ? { tone: "muted", title: "Not on a bus yet", text: `${t.orgName} hasn't put ${t.childName} on a bus yet.` }
    : t.child?.state === "onboard"
      ? { tone: "checkin", title: "On the bus", text: `Boarded Bus ${t.bus.number} at ${at(t.child.at)}.` }
      : t.child?.state === "dropped"
        ? {
            tone: "checkout",
            title: t.ride?.direction === "to_school" ? "At school" : "Dropped off",
            text:
              t.ride?.direction === "to_school"
                ? `Arrived at school at ${at(t.child.at)}.`
                : `Got off at ${at(t.child.at)}${t.child.guardianName ? `, handed to ${t.child.guardianName}` : ""}.`,
          }
        : t.ride
          ? { tone: "signal", title: "Not on the bus yet", text: `Bus ${t.bus.number} is on its ${DIRECTION_LABEL[t.ride.direction].toLowerCase()}.` }
          : { tone: "muted", title: "No ride right now", text: `Bus ${t.bus.number} isn't on a ride.` };

  return (
    <div className="min-h-screen pb-16">
      <header className="bg-gradient-ink px-4 pb-10 pt-6 text-ink-foreground">
        <div className="mx-auto max-w-xl">
          <div className="flex items-center gap-2.5">
            <GateMark className="size-7" />
            <p className="font-display font-semibold leading-tight">{t.orgName}</p>
          </div>
          <p className="mt-6 text-sm text-ink-muted">Where is my child?</p>
          <h1 className="text-3xl font-extrabold leading-tight">{t.childName}</h1>
          {(t.className || t.branchName) && (
            <p className="mt-1 text-ink-muted">{[t.className, t.children.length > 1 ? t.branchName : null].filter(Boolean).join(" · ")}</p>
          )}
        </div>
      </header>

      {t.children.length > 1 && (
        <nav aria-label="Select child" className="mx-auto mt-4 max-w-xl px-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Select child</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {t.children.map((c) => (
              <Link
                key={c.token}
                to="/bus/$token"
                params={{ token: c.token }}
                replace
                className={cn(
                  "shrink-0 rounded-2xl border px-3.5 py-2 text-sm",
                  c.current ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary",
                )}
              >
                <span className="block font-medium">{c.name}</span>
                <span className={cn("block text-xs", c.current ? "opacity-80" : "text-muted-foreground")}>
                  {[c.branch, c.bus ? `Bus ${c.bus}` : "No bus yet"].filter(Boolean).join(" · ")}
                </span>
              </Link>
            ))}
          </div>
        </nav>
      )}

      <main className={cn("mx-auto max-w-xl space-y-4 px-4", t.children.length > 1 ? "mt-4" : "-mt-5")}>
        <section className="rounded-3xl border bg-card p-5 shadow-soft">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-2xl",
                status.tone === "checkin" && "bg-checkin/15 text-checkin",
                status.tone === "checkout" && "bg-checkout/15 text-checkout",
                status.tone === "signal" && "bg-signal/20 text-signal-foreground",
                status.tone === "muted" && "bg-muted text-muted-foreground",
              )}
            >
              {status.tone === "checkout" ? <CheckCircle2 /> : status.tone === "muted" ? <Clock /> : <Bus />}
            </span>
            <div>
              <p className="font-display text-xl font-bold">{status.title}</p>
              <p className="text-sm text-muted-foreground">{status.text}</p>
            </div>
          </div>
          {t.lastSeen && (
            <p className="mt-4 flex items-start gap-2 rounded-2xl bg-muted p-3 text-sm font-medium">
              <MapPin className="mt-0.5 size-4 shrink-0" />
              <span>
                {lastSeenText(t.lastSeen.place, t.lastSeen.at, dataUpdatedAt || Date.now())}
                {t.lastSeen.updating ? (
                  <span className="font-normal text-muted-foreground"> · asking the bus for an update…</span>
                ) : (
                  t.lastSeen.stale && <span className="font-normal text-muted-foreground"> · no signal since</span>
                )}
              </span>
            </p>
          )}
        </section>

        {t.bus && (
          <section className="rounded-3xl border bg-card p-5 shadow-soft">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Bus</p>
            <p className="font-display text-3xl font-extrabold">{t.bus.number}</p>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{t.bus.plate}</span>
              {t.bus.route && ` · ${t.bus.route}`}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <Crew label="Driver" name={t.bus.driver} />
              <Crew label="Attendant" name={t.bus.attendant} />
            </div>
          </section>
        )}

        {t.emergencyPhone && (
          <p className="pt-2 text-center text-sm">
            <a
              href={telHref(t.emergencyPhone)}
              className="inline-flex items-center gap-1.5 font-medium text-checkout underline underline-offset-4"
            >
              <PhoneCall className="size-4" /> Not expecting this? Call {t.orgName}
            </a>
          </p>
        )}
      </main>
    </div>
  );
}

function Crew({ label, name }: { label: string; name: string | null }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-muted p-3">
      <UserRound className="size-4 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-medium">{name ?? "Not assigned"}</p>
      </div>
    </div>
  );
}
