import { createFileRoute } from "@tanstack/react-router";

/**
 * Home-screen manifest for one family.
 *
 * iPhone reads only the app manifest when a page is added to the home screen,
 * and it opens whatever that manifest says. Serving a copy per family means the
 * icon opens that family's children page directly, with no saved state needed.
 */
export const Route = createFileRoute("/api/parent-manifest/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const token = params.token.replace(/\.webmanifest$/i, "");
        if (!/^[a-f0-9]{64}$/i.test(token))
          return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

        const familyPage = `/parent/app/${token.toLowerCase()}`;
        // The installed icon is named after the family's own school.
        let schoolName: string | null = null;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: tokenRow } = await supabaseAdmin
            .from("parent_pwa_tokens")
            .select("org_id")
            .eq("pwa_token", token.toLowerCase())
            .maybeSingle();
          if (tokenRow?.org_id) {
            const { data: org } = await supabaseAdmin
              .from("organizations")
              .select("name")
              .eq("id", tokenRow.org_id)
              .maybeSingle();
            schoolName = org?.name ?? null;
          }
        } catch {
          // A missing school name only costs the label, never the app.
        }
        const manifest = {
          id: familyPage,
          name: schoolName ? `GoGuard • ${schoolName}` : "GoGuard",
          short_name: "GoGuard",
          description:
            "Track your child's school status in real time: gate check-ins, bus location, and pick-up/drop-off.",
          start_url: familyPage,
          scope: "/parent/",
          display: "standalone",
          background_color: "#f6f1e5",
          theme_color: "#1d3a30",
          orientation: "portrait-primary",
          icons: [
            { src: "/icons/icon-72x72.png", sizes: "72x72", type: "image/png", purpose: "any" },
            { src: "/icons/icon-96x96.png", sizes: "96x96", type: "image/png", purpose: "any" },
            { src: "/icons/icon-128x128.png", sizes: "128x128", type: "image/png", purpose: "any" },
            { src: "/icons/icon-144x144.png", sizes: "144x144", type: "image/png", purpose: "any" },
            { src: "/icons/icon-152x152.png", sizes: "152x152", type: "image/png", purpose: "any" },
            { src: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icons/icon-384x384.png", sizes: "384x384", type: "image/png", purpose: "any" },
            { src: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            {
              src: "/icons/maskable-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "/icons/maskable-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
          categories: ["education", "utilities"],
          prefer_related_applications: false,
        };

        return new Response(JSON.stringify(manifest), {
          headers: {
            "Content-Type": "application/manifest+json",
            "Cache-Control": "no-cache",
          },
        });
      },
    },
  },
});
