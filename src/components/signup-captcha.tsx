import { useEffect, useRef } from "react";

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};

export function SignupCaptcha({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let widget: string | undefined;
    let disposed = false;
    const api = () => (window as Window & { turnstile?: Turnstile }).turnstile;
    const render = () => {
      const element = container.current;
      const turnstile = api();
      if (disposed || !element || !turnstile || widget) return;
      widget = turnstile.render(element, {
        sitekey: siteKey, action: "school-signup", callback: onToken,
        "expired-callback": () => onToken(""), "error-callback": () => onToken(""),
      });
    };
    let script = document.querySelector<HTMLScriptElement>('script[data-signup-captcha]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.dataset["signupCaptcha"] = "true";
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    render();
    return () => {
      disposed = true;
      script?.removeEventListener("load", render);
      if (widget) api()?.remove(widget);
    };
  }, [siteKey, onToken]);
  return <div ref={container} className="min-h-16 max-w-full overflow-hidden" />;
}