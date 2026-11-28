import { useEffect, useState } from "react";
import { Bell, ChevronDown, Smartphone } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Platform = "ios" | "android" | "other";

const STORAGE_KEY = "goguard_app_guide_dismissed";

/**
 * Two pictures, drawn in the page, of the exact buttons to tap on each kind of
 * phone. Numbers on the drawing match the numbered steps next to it, so a
 * parent who cannot read English well can still follow the shapes.
 */
function AndroidPicture() {
  return (
    <svg
      viewBox="0 0 120 150"
      className="h-36 w-auto shrink-0"
      role="img"
      aria-label="Android phone: the three-dot menu at the top right opens Add to Home screen"
    >
      <rect x="26" y="4" width="68" height="136" rx="11" fill="#fffdf8" stroke="#1d3a30" strokeWidth="2" />
      <rect x="52" y="9" width="16" height="3" rx="1.5" fill="#cbd5cf" />
      <circle cx="84" cy="24" r="8.5" fill="#f2b13c" stroke="#1d3a30" strokeWidth="1.2" />
      <circle cx="81" cy="20.5" r="1.3" fill="#3a2a0c" />
      <circle cx="81" cy="24" r="1.3" fill="#3a2a0c" />
      <circle cx="81" cy="27.5" r="1.3" fill="#3a2a0c" />
      <text x="84" y="40" textAnchor="middle" fontSize="8" fontWeight="700" fill="#1d3a30">
        1
      </text>
      <rect x="34" y="48" width="52" height="40" rx="5" fill="#f6f1e5" stroke="#1d3a30" strokeWidth="1.2" />
      <rect x="38" y="66" width="44" height="12" rx="3" fill="#ffffff" stroke="#1d3a30" strokeWidth="1.2" />
      <text x="41" y="74.5" fontSize="5.5" fontWeight="700" fill="#1d3a30">
        Add to Home
      </text>
      <text x="60" y="90" textAnchor="middle" fontSize="8" fontWeight="700" fill="#1d3a30">
        2
      </text>
      <circle cx="60" cy="118" r="11" fill="#f2b13c" />
      <path d="M55 118l3.5 3.5L65 114" fill="none" stroke="#3a2a0c" strokeWidth="2.4" strokeLinecap="round" />
      <text x="60" y="139" textAnchor="middle" fontSize="8" fontWeight="700" fill="#1d3a30">
        3
      </text>
    </svg>
  );
}

function IosPicture() {
  return (
    <svg
      viewBox="0 0 120 150"
      className="h-36 w-auto shrink-0"
      role="img"
      aria-label="iPhone: the share button at the bottom opens Add to Home Screen"
    >
      <rect x="26" y="4" width="68" height="136" rx="13" fill="#fffdf8" stroke="#1d3a30" strokeWidth="2" />
      <rect x="48" y="8" width="24" height="3" rx="1.5" fill="#cbd5cf" />
      <rect x="34" y="18" width="52" height="70" rx="4" fill="#f6f1e5" stroke="#e7dfcf" />
      <rect x="34" y="106" width="52" height="18" rx="5" fill="#eef3f0" stroke="#1d3a30" strokeWidth="1.2" />
      <path d="M60 112v10M56 115l4-4 4 4" fill="none" stroke="#3a2a0c" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="60" cy="115" r="10" fill="none" stroke="#f2b13c" strokeWidth="2.6" />
      <text x="60" y="103" textAnchor="middle" fontSize="8" fontWeight="700" fill="#1d3a30">
        1
      </text>
      <rect x="34" y="46" width="52" height="38" rx="5" fill="#ffffff" stroke="#1d3a30" strokeWidth="1.2" />
      <rect x="37" y="56" width="46" height="11" rx="3" fill="#f6f1e5" stroke="#1d3a30" strokeWidth="1" />
      <text x="40" y="63.5" fontSize="5" fontWeight="700" fill="#1d3a30">
        Add to Home Screen
      </text>
      <text x="60" y="78" textAnchor="middle" fontSize="8" fontWeight="700" fill="#1d3a30">
        2
      </text>
      <circle cx="60" cy="122" r="0" fill="none" />
      <text x="60" y="139" textAnchor="middle" fontSize="8" fontWeight="700" fill="#1d3a30">
        3
      </text>
    </svg>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
        {n}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/**
 * First-visit help: save GoGuard to the home screen and switch alerts on. It is
 * a single row until opened, and disappears for good once dismissed, so it
 * never pushes the child's status down the screen.
 */
export function ParentInstallGuide({
  onEnableAlerts,
  alertsOn,
  className,
}: {
  onEnableAlerts: () => void;
  alertsOn: boolean;
  className?: string;
}) {
  const [platform, setPlatform] = useState<Platform>("other");
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // Private browsing can block storage: the guide just shows each visit.
    }
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    // Already opened from the home-screen icon: there is nothing left to save.
    if (standalone || dismissed) return;

    const ua = navigator.userAgent;
    const ios =
      /iPad|iPhone|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
    setPlatform(ios ? "ios" : /Android/i.test(ua) ? "android" : "other");
    setOpen(true);
    setVisible(true);
  }, []);

  if (!visible) return null;

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Nothing to save; it simply shows again next time.
    }
    setVisible(false);
  }

  const isIos = platform === "ios";
  const device = isIos ? "iPhone" : platform === "android" ? "Android phone" : "phone";

  return (
    <Card className={cn("border-primary/30 bg-primary/5", className)}>
      <div className="flex items-start gap-3 px-4 pt-4">
        <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Put GoGuard on your {device}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Save it like an app and turn on alerts. Takes about 2 minutes, once only.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={open ? "Hide the steps" : "Show the steps"}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </Button>
      </div>

      {open && (
        <CardContent className="space-y-4 pt-3 text-sm">
          <div className="flex items-start gap-3">
            {isIos ? <IosPicture /> : <AndroidPicture />}
            <ol className="min-w-0 flex-1 space-y-1.5">
              {isIos ? (
                <>
                  <Step n={1}>Open this page in Safari, then tap the share square at the bottom.</Step>
                  <Step n={2}>Tap “Add to Home Screen”, then tap “Add”.</Step>
                  <Step n={3}>
                    Close Safari and open GoGuard from the new icon on your Home Screen.
                  </Step>
                </>
              ) : (
                <>
                  <Step n={1}>Open this page in Chrome, then tap the three dots at the top right.</Step>
                  <Step n={2}>Tap “Add to Home screen”, then tap “Add”.</Step>
                  <Step n={3}>
                    Close Chrome and open GoGuard from the new icon on your Home screen.
                  </Step>
                </>
              )}
            </ol>
          </div>

          <div className="rounded-xl bg-background/70 p-3">
            <p className="flex items-center gap-2 font-medium">
              <Bell className="size-4 text-primary" /> Then turn alerts on
            </p>
            {alertsOn ? (
              <p className="mt-1 text-muted-foreground">
                Alerts are already on for this phone. You're all set.
              </p>
            ) : (
              <>
                <p className="mt-1 text-muted-foreground">
                  {isIos
                    ? "On iPhone, alerts only work after the app is on your Home Screen. Open it from there and tap “Allow” when the phone asks about notifications."
                    : "Open GoGuard from the new icon, tap Alerts at the top of the page, then tap “Allow” when the phone asks about notifications."}
                </p>
                <Button variant="signal" size="sm" className="mt-2 w-full" onClick={onEnableAlerts}>
                  <Bell className="mr-2 size-4" /> Turn on alerts now
                </Button>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={dismiss}
            className="mx-auto block text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            Done, hide this
          </button>
        </CardContent>
      )}
    </Card>
  );
}
