import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Bus,
  Check,
  CheckCircle2,
  QrCode,
  Quote,
  Users,
} from "lucide-react";

import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { TRIAL_DAYS } from "@/lib/billing";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// The hero photo is a Lovable-hosted asset (`hero-gate.png.asset.json`) and its
// `/__l5e/...` URL only resolves inside Lovable, so it 404s everywhere else.
// `public/hero-gate.svg` ships with the repo to keep the layout intact; drop a
// real photo at `public/hero-gate.png` and point this constant at it to swap in.
const heroImg = "/hero-gate.svg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GoGuard — Safe school drop-off and pick-up" },
      {
        name: "description",
        content:
          "Verified guardians, QR gate passes and instant email alerts for school drop-off and pick-up.",
      },
      { property: "og:title", content: "GoGuard — Safe school drop-off and pick-up" },
      {
        property: "og:description",
        content: "Verified guardians, QR gate passes and instant email alerts for schools.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const POINTS = ["Verified guardians.", "QR gate passes.", "Instant parent alerts."];

const FAQS = [
  {
    question: "What does GoGuard do for my school?",
    answer:
      "GoGuard brings guardian verification, gate records, automatic class attendance and school transport into one place.",
  },
  {
    question: "Do parents need to download an app?",
    answer:
      "No. Parents register their child and trusted guardians through the school's link. Each child can have up to four guardians.",
  },
  {
    question: "Does GoGuard work when the internet drops?",
    answer:
      "The bus app can queue ride records offline and sync them when internet returns. Gate QR verification needs an internet connection before a child is released.",
  },
  {
    question: "Which plan includes the free trial?",
    answer:
      "Basic Gate includes a 14-day free trial with no payment to start. School Standard and Multi-School Group are paid plans, with no free trial.",
  },
  {
    question: "Can we manage school buses and multiple branches?",
    answer:
      "School Standard includes up to four buses for one branch. Multi-School Group includes up to six buses and three branches, with an extra-branch add-on.",
  },
  {
    question: "How is attendance recorded?",
    answer:
      "Attendance is counted automatically from gate scans and bus rides, grouped by class and ready to download to Excel.",
  },
  {
    question: "How can our school pay?",
    answer: "Pay monthly through Paystack using a card, bank transfer or USSD.",
  },
];

const FEATURES = [
  {
    icon: QrCode,
    title: "Gate passes",
    line: "Every guardian gets a personal QR pass for one child. Guards scan it, see the photo, and know at once who may take the child home.",
  },
  {
    icon: Bus,
    title: "School bus",
    line: "Follow every bus live, see who is on board, and tell parents the moment their child is picked up or dropped off.",
  },
  {
    icon: Users,
    title: "Classes",
    line: "Students are sorted by class as parents register, so missing pupils and double registrations stand out straight away.",
  },
  {
    icon: BarChart3,
    title: "Reports",
    line: "Attendance fills itself in from every scan and bus ride. Download all your classes to Excel in one click.",
  },
];

function Landing() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="bg-aurora pointer-events-none absolute inset-0 -z-10" aria-hidden />
      <div
        className="grid-lines pointer-events-none absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]"
        aria-hidden
      />

      <header className="sticky top-3 z-30 mx-auto mt-3 w-[calc(100%-1.5rem)] max-w-6xl">
        <div className="glass flex h-14 items-center justify-between rounded-full pl-5 pr-2">
          <Brand />
          <nav className="flex items-center gap-1">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden rounded-full sm:inline-flex"
            >
              <Link to="/pricing">Pricing</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="rounded-full">
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button asChild size="sm" className="rounded-full">
              <Link to="/signup">Register</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4">
        <section className="grid items-center gap-12 pb-16 pt-12 md:grid-cols-[1fr_1.05fr] md:pt-20">
          <div>
            <h1 className="sr-only">GoGuard — safe school drop-off and pick-up</h1>
            <ul className="grid max-w-xs gap-2">
              {POINTS.map((label) => (
                <li key={label} className="glass flex items-center gap-3 rounded-xl px-3.5 py-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-checkin text-checkin-foreground">
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                  <span className="font-display text-base font-semibold tracking-tight sm:text-lg">
                    {label}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-10 flex flex-wrap gap-3">
              <Button
                asChild
                variant="signal"
                size="lg"
                className="h-12 rounded-full px-6 text-base shadow-pass"
              >
                <Link to="/signup">
                  Register your school <ArrowRight />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="glass h-12 rounded-full px-6 text-base"
              >
                <Link to="/pricing">Check our pricing</Link>
              </Button>
            </div>
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-checkin" /> {TRIAL_DAYS}-day free trial. No
              payment to start.
            </p>
          </div>

          <div className="relative">
            <div className="glass rounded-[2.25rem] p-2.5">
              <img
                src={heroImg}
                alt="A parent and child at a school gate while staff scan the parent's QR pass"
                width={1200}
                height={960}
                className="aspect-[5/4] w-full rounded-[1.75rem] object-cover"
              />
            </div>
            <div className="glass-strong animate-float absolute -left-3 top-8 flex items-center gap-3 rounded-2xl px-4 py-3 sm:-left-8">
              <span className="flex size-9 items-center justify-center rounded-xl bg-checkin text-checkin-foreground">
                <CheckCircle2 className="size-5" />
              </span>
              <div className="leading-tight">
                <p className="text-sm font-semibold">Check-in recorded</p>
                <p className="text-xs text-muted-foreground">Chidi O. · 7:42 AM</p>
              </div>
            </div>
            <div
              className="glass-strong animate-float absolute -right-2 bottom-10 flex items-center gap-3 rounded-2xl px-4 py-3 sm:-right-6"
              style={{ animationDelay: "-3s" }}
            >
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Bus className="size-5" />
              </span>
              <div className="leading-tight">
                <p className="text-sm font-semibold">Bus 03 on route</p>
                <p className="text-xs text-muted-foreground">14 pupils on board</p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 pb-20 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="glass rounded-3xl p-5 transition hover:-translate-y-0.5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                <f.icon className="size-5 text-primary" />
              </span>
              <p className="mt-4 font-display text-lg font-bold">{f.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.line}</p>
            </div>
          ))}
        </section>

        <section aria-label="GoGuard in numbers" className="border-y border-border py-9 sm:py-12">
          <div className="grid grid-cols-1 gap-7 text-center sm:grid-cols-3 sm:gap-4">
            {[
              { value: "100+", label: "Schools" },
              { value: "15,000+", label: "Students secured" },
              { value: "332,000+", label: "Releases processed" },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="font-display text-4xl font-bold text-primary">{stat.value}</p>
                <p className="mt-2 text-sm text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-14 sm:py-20" aria-labelledby="reviews-title">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            From the school office
          </p>
          <h2 id="reviews-title" className="mt-3 text-3xl font-bold">
            A little more peace of mind.
          </h2>
          <figure className="mt-8 max-w-3xl border-l-2 border-signal pl-6 sm:pl-8">
            <Quote className="size-8 text-primary" aria-hidden />
            <blockquote className="mt-4 font-display text-2xl leading-relaxed">
              “This app is great and even works offline when there’s an internet break.”
            </blockquote>
            <figcaption className="mt-5 text-sm">
              <span className="font-semibold">Bimbo</span>
              <span className="text-muted-foreground"> · School administrator · Lagos</span>
            </figcaption>
          </figure>
        </section>

        <section
          className="grid gap-8 border-t border-border py-14 sm:py-20 md:grid-cols-[1fr_1.5fr]"
          aria-labelledby="faq-title"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              A few answers
            </p>
            <h2 id="faq-title" className="mt-3 text-3xl font-bold">
              Frequently asked questions
            </h2>
            <Button asChild variant="outline" className="mt-6">
              <Link to="/pricing">
                Compare plans <ArrowRight />
              </Link>
            </Button>
          </div>
          <Accordion type="single" collapsible>
            {FAQS.map((faq, i) => (
              <AccordionItem key={faq.question} value={`faq-${i}`}>
                <AccordionTrigger className="gap-4 py-5 text-base">{faq.question}</AccordionTrigger>
                <AccordionContent className="leading-relaxed text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      </main>

      <footer className="mx-auto mb-4 w-[calc(100%-1.5rem)] max-w-6xl">
        <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-3xl px-5 py-4 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} GoGuard</span>
          <span className="flex gap-4">
            <Link to="/pricing" className="hover:text-foreground">
              Pricing
            </Link>
            <Link to="/signup" className="hover:text-foreground">
              Register
            </Link>
            <Link to="/auth" className="hover:text-foreground">
              Sign in
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
