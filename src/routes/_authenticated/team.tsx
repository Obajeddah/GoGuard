import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { GateStaff } from "@/components/gate-staff";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({
    meta: [
      { title: "School team · GoGuard" },
      { name: "description", content: "Manage school gate staff and their access." },
      { property: "og:title", content: "School team · GoGuard" },
      { property: "og:description", content: "Manage school gate staff and their access." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell adminOnly>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Team</h1>
        <GateStaff />
      </div>
    </AppShell>
  ),
});
