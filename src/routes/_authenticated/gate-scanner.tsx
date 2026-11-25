import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { GateScanner } from "@/components/gate-scanner";

export const Route = createFileRoute("/_authenticated/gate-scanner")({
  head: () => ({
    meta: [
      { title: "Guard gate scanner — GoGuard" },
      { name: "description", content: "Scan and verify guardian QR passes at the school gate." },
      { property: "og:title", content: "Guard gate scanner — GoGuard" },
      {
        property: "og:description",
        content: "Scan and verify guardian QR passes at the school gate.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell tone="dark">
      <GateScanner />
    </AppShell>
  ),
});
