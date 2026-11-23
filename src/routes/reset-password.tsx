import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthFrame, Field } from "@/components/auth-frame";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — GoGuard" },
      { name: "description", content: "Choose a new password for your GoGuard account." },
      { property: "og:title", content: "Set a new password — GoGuard" },
      { property: "og:description", content: "Choose a new password for your GoGuard account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError("This reset link has expired. Request a new one from the sign-in page.");
      return;
    }
    toast.success("Password updated");
    navigate({ to: "/auth" });
  }

  return (
    <AuthFrame>
      <h1 className="text-3xl font-bold">Set a new password</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <Field label="New password" error={error ?? undefined}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Update password
        </Button>
      </form>
    </AuthFrame>
  );
}
