import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/send-emails")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authenticateCronRequest } = await import("@/integrations/supabase/cron-auth");
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const { sendPendingEmails } = await import("@/lib/email-dispatch.server");
        const result = await sendPendingEmails(new URL(request.url).origin);
        return Response.json(result);
      },
    },
  },
});
