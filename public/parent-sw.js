// Service Worker for GoGuard Parent PWA
// Caches the parent app shell for offline access and handles push alerts.

const CACHE_NAME = "goguard-parent-v7";
const META_CACHE = "goguard-parent-meta";
const STATIC_ASSETS = [
  "/parent/app",
  "/parent-manifest.json",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
];

// The app tells us its personal link once it is open, so a tap on an alert can
// always come back to the right children instead of the school's sign-in page.
async function saveParentToken(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) return;
  try {
    const cache = await caches.open(META_CACHE);
    await cache.put(new Request("/__parent_token"), new Response(token.toLowerCase()));
  } catch {
    // Storage can be unavailable; alerts still open the app entry page.
  }
}

async function readParentToken() {
  try {
    const cache = await caches.open(META_CACHE);
    const cached = await cache.match("/__parent_token");
    if (!cached) return null;
    const token = (await cached.text()).trim();
    return /^[a-f0-9]{64}$/i.test(token) ? token : null;
  } catch {
    return null;
  }
}

/** A push may carry the exact page; otherwise fall back to the saved link. */
async function parentPageUrl(candidate) {
  if (typeof candidate === "string" && /^\/parent\/app\/[a-f0-9]{64}$/i.test(candidate)) {
    return candidate;
  }
  const token = await readParentToken();
  return token ? `/parent/app/${token}` : "/parent/app/";
}

// Install: cache the app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== META_CACHE)
          .map((name) => caches.delete(name)),
      );
    }),
  );
  self.clients.claim();
});

// Fetch: serve from cache first, then network
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests for our scope
  if (request.method !== "GET" || !url.pathname.startsWith("/parent/")) {
    return;
  }

  // Skip non-HTTPS in production
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    return;
  }

  // Pages always come from the network first, so a newly released app is used
  // straight away instead of a page the phone saved weeks ago. The saved copy
  // is only used when the phone is genuinely offline.
  const acceptsHtml = (request.headers.get("accept") || "").includes("text/html");
  if (request.mode === "navigate" || acceptsHtml) {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match("/parent/app")
          .then((cached) => cached || new Response("Offline", { status: 503 })),
      ),
    );
    return;
  }

  // Everything else (icons, manifest, styles, scripts) can be served from the
  // saved copy and refreshed in the background.
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        event.waitUntil(
          fetch(request)
            .then((networkResponse) => {
              if (networkResponse.ok) {
                return caches.open(CACHE_NAME).then((cache) => {
                  cache.put(request, networkResponse.clone());
                });
              }
            })
            .catch(() => {
              // Ignore network errors for background update
            }),
        );
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => new Response("Offline", { status: 503 }));
    }),
  );
});

// The page shares its personal link so alerts deep-link back to it.
self.addEventListener("message", (event) => {
  if (!event.data) return;
  if (event.data === "skipWaiting") {
    self.skipWaiting();
    return;
  }
  if (event.data.type === "parent-token" && event.data.token) {
    event.waitUntil(saveParentToken(event.data.token));
  }
});

// Push: this is what actually shows a notification on the phone.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "GoGuard", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "GoGuard";
  event.waitUntil(
    (async () => {
      const url = await parentPageUrl(payload.data && payload.data.url);
      await self.registration.showNotification(title, {
        body: payload.body || "",
        icon: payload.icon || "/icons/icon-192x192.png",
        badge: payload.badge || "/icons/icon-72x72.png",
        tag: payload.tag || "goguard",
        renotify: true,
        vibrate: [90, 60, 90],
        data: { url },
      });
    })(),
  );
});

// Tapping the notification opens (or focuses) the parent app, on the right child.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const page = await parentPageUrl(event.notification.data && event.notification.data.url);
      const target = new URL(page, self.location.origin).href;
      const list = await clients.matchAll({ type: "window", includeUncontrolled: true });

      for (const client of list) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      for (const client of list) {
        if (client.url.startsWith(`${self.location.origin}/parent/`) && "navigate" in client) {
          try {
            const navigated = await client.navigate(target);
            return (navigated || client).focus();
          } catch {
            // Fall through to opening a new window.
          }
        }
      }
      return clients.openWindow(target);
    })(),
  );
});
