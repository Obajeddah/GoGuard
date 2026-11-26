import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/instant-emails")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authenticateCronRequest } = await import("@/integrations/supabase/cron-auth");
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const { processInstantEmailQueue } = await import("@/lib/instant-email.server");
        const result = await processInstantEmailQueue({
          data: { siteUrl: new URL(request.url).origin, batchSize: 50 },
        });
        return Response.json(result);
      },
    },
  },
});
