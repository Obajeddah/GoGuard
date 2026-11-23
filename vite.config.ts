// The Lovable wrapper supplies tanstackStart, React, Tailwind and path aliases.
// For self-hosting we disable its Cloudflare/Nitro default and let Netlify's
// official TanStack Start plugin configure the SSR build and Functions output.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import netlify from "@netlify/vite-plugin-tanstack-start";

export default defineConfig({
  nitro: false,
  plugins: [netlify()],
  tanstackStart: {
    // Keep the shared SSR error wrapper used by the app.
    server: { entry: "server" },
  },
});
