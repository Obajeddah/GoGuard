import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe, accessOf } from "@/hooks/use-me";
import { useBranch, setSelectedBranch } from "@/hooks/use-branch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/auth-frame";

export function SchoolSecurity() {
  const { data: me } = useMe();
  const { branches } = useBranch();
  const access = accessOf(me);
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const code = useQuery({ queryKey: ["edit-code", me?.org?.id], enabled: access.isAdmin && access.isHq, queryFn: async () => {
    const { data, error } = await supabase.from("org_secrets").select("edit_pin").eq("org_id", me?.org?.id ?? "").single();
    if (error) throw error;
    return data;
  } });
  const add = useMutation({ mutationFn: async () => {
    if (!me?.org || !name.trim()) throw new Error("Enter the branch name");
    const { data, error } = await supabase.from("branches").insert({ org_id: me.org.id, name: name.trim(), address: address.trim() || null }).select("id").single();
    if (error) throw new Error(error.message);
    return data;
  }, onSuccess: (data) => { setName(""); setAddress(""); client.invalidateQueries({ queryKey: ["me"] }); if (data) setSelectedBranch(data.id); toast.success("Branch created"); }, onError: (e) => toast.error(e.message) });
  const save = useMutation({ mutationFn: async () => {
    if (!me?.org || !/^\d{4}$/.test(pin) || pin !== confirm) throw new Error("Enter matching 4-digit codes");
    const { error } = await supabase.from("org_secrets").update({ edit_pin: pin }).eq("org_id", me.org.id);
    if (error) throw new Error(error.message);
  }, onSuccess: () => { setPin(""); setConfirm(""); client.invalidateQueries({ queryKey: ["edit-code"] }); toast.success("Edit code changed"); }, onError: (e) => toast.error(e.message) });
  return <>
    {access.isHq && <section className="space-y-4 border-t pt-6">
      <h2 className="text-xl font-bold">Branches</h2>
      <ul className="divide-y">{branches.map((b) => <li key={b.id} className="py-3"><p className="font-medium">{b.name}</p><p className="text-sm text-muted-foreground">{b.address}</p></li>)}</ul>
      {access.multiBranch && <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <Field label="Branch name"><Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Address"><Input maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Button type="submit" disabled={add.isPending || !name.trim()}>Add branch</Button>
      </form>}
    </section>}
    <section className="space-y-4 border-t pt-6">
      <h2 className="text-xl font-bold">Account security</h2>
      <p className="text-sm text-muted-foreground">Two-step sign-in is required for every administrator.</p>
      {access.isHq && <>
        <h3 className="font-semibold">Student edit code</h3>
        {code.data && <p className="text-sm">Current code: <span className="font-mono">{code.data.edit_pin}</span></p>}
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Field label="New 4-digit code"><Input type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="Confirm code"><Input type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))} /></Field>
          <Button type="submit" disabled={save.isPending || pin.length !== 4 || pin !== confirm}>Change edit code</Button>
        </form>
      </>}
    </section>
  </>;
}