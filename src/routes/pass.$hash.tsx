import { createFileRoute, notFound } from "@tanstack/react-router";

import { getPass } from "@/lib/registration.functions";
import { isRateLimitResponse } from "@/lib/rate-limit";
import { termsFor } from "@/lib/org-terms";
import { PassCard } from "@/components/pass-card";
import { EmergencyLine } from "@/components/emergency-line";

export const Route = createFileRoute("/pass/$hash")({
  loader: async ({ params }) => {
    const pass = await getPass({ data: { hash: params.hash } }).catch((error) => {
      // A 429 must reach the browser as 429, not as a misleading "pass not found".
      if (isRateLimitResponse(error)) throw error;
      return null;
    });
    if (!pass) throw notFound();
    return { pass };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.pass.name} · GoGuard` : "Gate pass · GoGuard" },
      {
        name: "description",
        content: "Your personal gate pass. Show this QR code to the guard at the gate.",
      },
      { property: "og:title", content: "Your gate pass" },
      {
        property: "og:description",
        content: "Your personal gate pass. Show this QR code to the guard at the gate.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <div>
        <h1 className="text-2xl font-bold">This pass isn't active</h1>
        <p className="mt-2 text-muted-foreground">
          It may have been removed. Please contact the parent who registered you.
        </p>
      </div>
    </div>
  ),
  component: PassPage,
});

function PassPage() {
  const { pass } = Route.useLoaderData();
  const terms = termsFor(pass.orgType);
  return (
    <div className="grid-lines flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <PassCard
        hash={pass.hash}
        guardianName={pass.name}
        relationship={pass.relationship}
        memberName={pass.memberName}
        identifier={pass.identifier}
        orgName={pass.orgName}
        photoUrl={pass.photoUrl}
        guardianLabel={terms.guardian}
      />
      <p className="mt-6 max-w-xs text-center text-sm text-muted-foreground">
        Show this code to the guard at every {terms.checkInHint.toLowerCase()} and{" "}
        {terms.checkOutHint.toLowerCase()}. Tip: add this page to your home screen so it's always to
        hand.
      </p>
      {pass.emergencyPhone && (
        <EmergencyLine
          phone={pass.emergencyPhone}
          orgName={pass.orgName}
          className="mt-6 w-full max-w-sm"
        />
      )}
    </div>
  );
}
