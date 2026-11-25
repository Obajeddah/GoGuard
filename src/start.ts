import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { guardRequest } from "./lib/rate-limit.server";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// Anonymous per-IP budgets for the public surfaces (pass, registration, bus)
// and for unauthenticated server-function traffic. Runs at the request
// boundary so it cannot be skipped by the client-side server-function stubs.
const rateLimitMiddleware = createMiddleware().server(async ({ request, handlerType, next }) => {
  const limited = guardRequest(request, handlerType === "router" ? "html" : "json");
  if (limited) return limited;
  return next();
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, rateLimitMiddleware, csrfMiddleware],
}));
