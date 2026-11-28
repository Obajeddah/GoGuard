import { useEffect, useRef } from "react";

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};

export type CaptchaStatus = "loading" | "ready" | "error";

export function SignupCaptcha({
  siteKey,
  onToken,
  onStatus,
  timeoutMs = 20000,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  onStatus?: (status: CaptchaStatus) => void;
  timeoutMs?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let widget: string | undefined;
    let disposed = false;
    let settled = false;
    const api = () => (window as Window & { turnstile?: Turnstile }).turnstile;

    onStatus?.("loading");

    // If Cloudflare never produces a token (blocked network, ad-blocker, bad
    // hostname), stop waiting silently and let the page offer a retry.
    const timer = window.setTimeout(() => {
      if (!disposed && !settled) onStatus?.("error");
    }, timeoutMs);

    const render = () => {
      const element = container.current;
      const turnstile = api();
      if (disposed || !element || !turnstile || widget) return;
      widget = turnstile.render(element, {
        sitekey: siteKey,
        action: "school-signup",
        callback: (token: string) => {
          settled = true;
          onStatus?.("ready");
          onToken(token);
        },
        "expired-callback": () => onToken(""),
        "error-callback": () => {
          settled = true;
          onStatus?.("error");
          onToken("");
        },
      });
    };

    const onScriptError = () => {
      if (!disposed) onStatus?.("error");
    };

    let script = document.querySelector<HTMLScriptElement>("script[data-signup-captcha]");
    if (!script) {
      script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.dataset["signupCaptcha"] = "true";
      script.addEventListener("error", onScriptError);
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    render();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      script?.removeEventListener("load", render);
      script?.removeEventListener("error", onScriptError);
      if (widget) api()?.remove(widget);
    };
  }, [siteKey, onToken, onStatus, timeoutMs]);
  return <div ref={container} className="min-h-16 max-w-full overflow-hidden" />;
}
