import { createFileRoute } from "@tanstack/react-router";

/**
 * PNG barcode for one gate pass. Emails point their <img> here instead of
 * embedding the QR, because mail clients strip inline images and data URIs.
 * The hash is the credential, so knowing the URL grants nothing extra.
 */
export const Route = createFileRoute("/api/qr/$hash")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        // Lower-case: the scanner lower-cases what it reads, so a code printed in
        // upper case would never match the stored pass.
        const hash = params.hash.replace(/\.png$/i, "").toLowerCase();
        if (!/^[a-f0-9]{64}$/i.test(hash))
          return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

        try {
          const QRCode = (await import("qrcode")).default;
          const png = await QRCode.toBuffer(hash, {
            type: "png",
            width: 424,
            margin: 1,
            errorCorrectionLevel: "M",
            color: { dark: "#15332cff", light: "#ffffffff" },
          });
          return new Response(new Uint8Array(png), {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          });
        } catch (error) {
          console.error("[qr] could not render pass code", error);
          return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
        }
      },
    },
  },
});
