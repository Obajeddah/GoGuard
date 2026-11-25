import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/use-me";
import { useBranch } from "@/hooks/use-branch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/auth-frame";
import { ClassSelect } from "@/components/class-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface Student {
  id: string;
  full_name: string;
  identifier_code: string | null;
  parent_or_owner_name: string | null;
  primary_email: string;
  primary_phone: string | null;
  branch_id: string;
}
export function EditStudent({ student }: { student: Student }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [form, setForm] = useState(student);
  const { data: me } = useMe();
  const { branches } = useBranch();
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("edit_member", {
        _member_id: student.id,
        _pin: pin,
        _full_name: form.full_name,
        _class: form.identifier_code ?? "",
        _parent_name: form.parent_or_owner_name ?? "",
        _email: form.primary_email,
        _phone: form.primary_phone ?? "",
        _branch_id: form.branch_id,
      });
      if (error) throw new Error(error.message);
      if (data === "locked") throw new Error("Too many incorrect codes. Try again in 15 minutes.");
      if (data !== "ok") throw new Error("Incorrect edit code.");
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["members"] });
      client.invalidateQueries({ queryKey: ["attendance"] });
      toast.success("Student updated");
      setOpen(false);
      setPin("");
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setForm(student);
          setPin("");
          setOpen(true);
        }}
      >
        <Pencil /> Edit details
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setPin("");
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit student</DialogTitle>
            <DialogDescription>{student.full_name}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Field label="Student name">
              <Input
                required
                maxLength={120}
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </Field>
            <Field label="Class">
              {me?.org?.classes.length ? (
                <ClassSelect
                  classes={me.org.classes}
                  value={form.identifier_code ?? ""}
                  onChange={(value) => setForm({ ...form, identifier_code: value })}
                />
              ) : (
                <Input
                  value={form.identifier_code ?? ""}
                  onChange={(e) => setForm({ ...form, identifier_code: e.target.value })}
                />
              )}
            </Field>
            <Field label="Parent name">
              <Input
                value={form.parent_or_owner_name ?? ""}
                onChange={(e) => setForm({ ...form, parent_or_owner_name: e.target.value })}
              />
            </Field>
            <Field label="Parent email">
              <Input
                required
                type="email"
                value={form.primary_email}
                onChange={(e) => setForm({ ...form, primary_email: e.target.value })}
              />
            </Field>
            <Field label="Parent phone">
              <Input
                type="tel"
                value={form.primary_phone ?? ""}
                onChange={(e) => setForm({ ...form, primary_phone: e.target.value })}
              />
            </Field>
            {me?.branchId === null && branches.length > 1 && (
              <Field label="Branch">
                <select
                  aria-label="Student branch"
                  className="h-10 w-full rounded-md border bg-background px-3"
                  value={form.branch_id}
                  onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="4-digit edit code">
              <Input
                required
                type="password"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </Field>
            <Button type="submit" disabled={save.isPending || pin.length !== 4}>
              {save.isPending && <Loader2 className="animate-spin" />}Save changes
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
