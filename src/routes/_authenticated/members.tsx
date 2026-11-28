import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  BellOff,
  ChevronDown,
  FileUp,
  Loader2,
  Plus,
  QrCode,
  Search,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/use-me";
import { useBranch, inBranch } from "@/hooks/use-branch";
import { readAll } from "@/lib/pagination";
import { EditStudent } from "@/components/edit-student";
import { usePhotoUrls } from "@/hooks/use-photo-urls";
import { MAX_GUARDIANS, termsFor, type OrgTerms } from "@/lib/org-terms";
import { can } from "@/lib/access";
import { uploadProfilePhoto } from "@/lib/photo.functions";
import { sendMemberPassEmails } from "@/lib/pass-email.functions";
import { createMember } from "@/lib/member.functions";
import { checkGuardianEmails } from "@/lib/email-check.functions";
import { parseCsv } from "@/lib/csv";
import { AppShell } from "@/components/app-shell";
import { Field } from "@/components/auth-frame";
import { PassCard, passUrl } from "@/components/pass-card";
import { PhotoPicker } from "@/components/photo-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { ClassSelect } from "@/components/class-select";
import { classGroups, findDuplicates, type DuplicateInfo } from "@/lib/classes";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/members")({
  head: () => ({
    meta: [
      { title: "Directory · GoGuard" },
      {
        name: "description",
        content: "Everyone registered at your gate, with their trusted guardians and passes.",
      },
      { property: "og:title", content: "Directory · GoGuard" },
      {
        property: "og:description",
        content: "Everyone registered at your gate, with their trusted guardians and passes.",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <MembersPage />
    </AppShell>
  ),
});

interface GuardianRow {
  id: string;
  name: string;
  relationship: string;
  photo_path: string | null;
  receive_general_notifications: boolean;
  unique_qr_hash: string;
}
interface MemberRow {
  id: string;
  full_name: string;
  identifier_code: string | null;
  parent_or_owner_name: string | null;
  branch_id: string;
  photo_path: string | null;
  created_at: string;
  guardians: GuardianRow[];
}

function MembersPage() {
  const { data: me } = useMe();
  const { branchId } = useBranch();
  const org = me!.org!;
  const terms = termsFor(org.type);
  const isAdmin = !!me?.isAdmin;
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [classFilter, setClassFilter] = useState<string>("all");
  const [dupOnly, setDupOnly] = useState(false);
  const schoolClasses = org.classes ?? [];



  const membersQuery = useQuery({
    queryKey: ["members", org.id, branchId],
    queryFn: async () => {
      return readAll((from, to) =>
        inBranch(
          supabase
            .from("members")
            .select(
              // Contact details never leave the server: the school only needs
              // names, classes and passes, and nothing here can be scraped.
              "id, branch_id, full_name, identifier_code, parent_or_owner_name, photo_path, created_at, guardians(id, name, relationship, photo_path, receive_general_notifications, unique_qr_hash)",
            )
            .eq("org_id", org.id)
            .order("full_name")
            .order("id"),
          branchId,
        ).range(from, to),
      ) as Promise<MemberRow[]>;
    },
  });

  const all = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const dupes = useMemo(() => findDuplicates(all), [all]);
  const byId = useMemo(() => new Map(all.map((m) => [m.id, m])), [all]);
  const classOptions = useMemo(() => {
    const groups = classGroups(all, schoolClasses);
    const count = (label: string | null) =>
      groups.find((g) => (g.label ?? null)?.toLowerCase() === label?.toLowerCase())?.members
        .length ?? 0;
    const labels = [
      ...schoolClasses,
      ...groups
        .map((g) => g.label)
        .filter(
          (l): l is string =>
            !!l && !schoolClasses.some((c) => c.toLowerCase() === l.toLowerCase()),
        ),
    ];
    return {
      classes: labels.map((l) => ({ label: l, count: count(l) })),
      none: groups.find((g) => g.label === null)?.members.length ?? 0,
    };
  }, [all, schoolClasses]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = all;
    if (dupOnly) list = list.filter((m) => dupes.has(m.id));
    if (classFilter === "__none") list = list.filter((m) => !m.identifier_code?.trim());
    else if (classFilter !== "all")
      list = list.filter(
        (m) => m.identifier_code?.trim().toLowerCase() === classFilter.toLowerCase(),
      );
    if (!term) return list;
    return list.filter((m) =>
      [
        m.full_name,
        m.identifier_code,
        m.parent_or_owner_name,
        ...m.guardians.map((g) => g.name),
      ]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(term)),
    );
  }, [all, q, dupOnly, dupes, classFilter]);
  const groups = useMemo(() => classGroups(filtered, schoolClasses), [filtered, schoolClasses]);

  const photos = usePhotoUrls(
    filtered.flatMap((m) => [m.photo_path, ...m.guardians.map((g) => g.photo_path)]),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{terms.members}</h1>
          <p className="text-muted-foreground">
            {membersQuery.data?.length ?? 0} registered · up to {MAX_GUARDIANS}{" "}
            {terms.guardians.toLowerCase()} each
          </p>
        </div>
        {can(isAdmin, "manage_members") && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImporting(true)}>
              <FileUp /> Bulk upload
            </Button>
            <Button variant="signal" onClick={() => setAdding(true)}>
              <Plus /> Add {terms.member.toLowerCase()}
            </Button>
          </div>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search by name or ${terms.identifier.toLowerCase()}`}
          className="pl-9"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`Filter by ${terms.identifier.toLowerCase()}`}
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
        >
          <option value="all">
            All {terms.members.toLowerCase()} ({all.length})
          </option>
          {classOptions.classes.map((c) => (
            <option key={c.label} value={c.label}>
              {c.label} ({c.count})
            </option>
          ))}
          {classOptions.none > 0 && (
            <option value="__none">
              No {terms.identifier.toLowerCase()} ({classOptions.none})
            </option>
          )}
        </select>
        {dupes.size > 0 && (
          <Button
            variant={dupOnly ? "signal" : "outline"}
            size="sm"
            onClick={() => setDupOnly((v) => !v)}
            aria-pressed={dupOnly}
          >
            <AlertTriangle /> Possible duplicates ({dupes.size})
          </Button>
        )}
      </div>

      {membersQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed p-10 text-center">
          <p className="font-medium">
            {q.trim() || classFilter !== "all" || dupOnly
              ? "No matches"
              : `No ${terms.members.toLowerCase()} yet`}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {classFilter !== "all" && !q.trim()
              ? `No ${terms.members.toLowerCase()} registered in this ${terms.identifier.toLowerCase()} yet.`
              : q.trim() || dupOnly
                ? "Try a different name or spelling."
                : isAdmin
                  ? `Share your registration link from the Live page, or add ${terms.members.toLowerCase()} here.`
                  : `${terms.members} appear here once they're registered.`}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.label ?? "__none"}>
              <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {g.label ?? `No ${terms.identifier.toLowerCase()}`}
                <span className="font-mono text-xs font-medium">{g.members.length}</span>
              </h2>
              <ul className="space-y-3">
                {g.members.map((m) => (
                  <MemberCard
                    key={m.id}
                    member={m}
                    terms={terms}
                    orgName={org.name}
                    photos={photos.data ?? {}}
                    isAdmin={isAdmin}
                    dup={dupes.get(m.id)}
                    byId={byId}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {isAdmin && (
        <>
          <AddMemberDialog
            open={adding}
            onOpenChange={setAdding}
            orgId={org.id}
            terms={terms}
            classes={schoolClasses}
          />
          <ImportDialog open={importing} onOpenChange={setImporting} orgId={org.id} terms={terms} />
        </>
      )}
    </div>
  );
}

function Thumb({ url, className }: { url?: string | undefined; className?: string | undefined }) {
  return (
    <div className={cn("shrink-0 overflow-hidden rounded-xl bg-muted", className ?? "size-11")}>
      {url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <User className="m-auto mt-[25%] size-1/2 text-muted-foreground" />
      )}
    </div>
  );
}

function MemberCard({
  member,
  terms,
  orgName,
  photos,
  isAdmin,
  dup,
  byId,
}: {
  member: MemberRow;
  terms: OrgTerms;
  orgName: string;
  photos: Record<string, string>;
  isAdmin: boolean;
  dup: DuplicateInfo | undefined;
  byId: Map<string, MemberRow>;
}) {
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState<GuardianRow | null>(null);
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["members"] });

  const toggleNotify = useMutation({
    mutationFn: async (g: GuardianRow) => {
      const { error } = await supabase
        .from("guardians")
        .update({ receive_general_notifications: !g.receive_general_notifications })
        .eq("id", g.id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: () => toast.error("Couldn't update notification settings."),
  });

  const removeGuardian = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("guardians").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success(`${terms.guardian} removed. Their pass no longer works.`);
    },
  });

  const removeMember = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("members").delete().eq("id", member.id);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success(`${member.full_name} removed`);
    },
  });

  return (
    <li className="overflow-hidden rounded-2xl border bg-card">
      <button
        className="flex w-full items-center gap-3 p-4 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <Thumb url={member.photo_path ? photos[member.photo_path] : undefined} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-semibold">
            <span className="truncate">{member.full_name}</span>
            {dup && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-signal/15 px-2 py-0.5 text-xs font-medium text-signal-foreground">
                <AlertTriangle className="size-3" /> Possible duplicate
              </span>
            )}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {[member.identifier_code, member.parent_or_owner_name].filter(Boolean).join(" · ") ||
              "No class set"}
          </p>
        </div>
        <div className="flex -space-x-2">
          {member.guardians.slice(0, 4).map((g) => (
            <Thumb
              key={g.id}
              url={g.photo_path ? photos[g.photo_path] : undefined}
              className="size-8 ring-2 ring-card"
            />
          ))}
        </div>
        <ChevronDown
          className={cn("size-5 text-muted-foreground transition", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="border-t bg-muted/40 p-4">
          {dup && (
            <div className="mb-4 rounded-xl border border-signal/40 bg-signal/10 p-3 text-sm">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="size-4" /> Same name registered {dup.others.length + 1}{" "}
                times
              </p>
              {dup.differentParents && (
                <p className="mt-1 font-medium text-destructive">
                  Registered under different parent names. Check with the parent you know before
                  removing one.
                </p>
              )}
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {[member.id, ...dup.others].map((id) => {
                  const o = byId.get(id);
                  if (!o) return null;
                  return (
                    <li key={id} className={cn(id === member.id && "font-medium text-foreground")}>
                      {id === member.id ? "This one" : o.full_name} ·{" "}
                      {o.identifier_code || `no ${terms.identifier.toLowerCase()}`} ·{" "}
                      {format(new Date(o.created_at), "d MMM yyyy, HH:mm")} ·{" "}
                      {o.guardians.length}{" "}
                      {o.guardians.length === 1
                        ? terms.guardian.toLowerCase()
                        : terms.guardians.toLowerCase()}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <p className="mb-1 text-xs text-muted-foreground">
            Registered {format(new Date(member.created_at), "d MMM yyyy, HH:mm")}
          </p>
          <p className="text-sm text-muted-foreground">
            Contact details are kept private. GoGuard uses them to send every update, so they are
            never shown here.
          </p>
          <ul className="mt-3 space-y-2">
            {member.guardians.map((g) => (
              <li key={g.id} className="flex items-center gap-3 rounded-xl bg-card p-3">
                <Thumb url={g.photo_path ? photos[g.photo_path] : undefined} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {g.name}{" "}
                    <span className="font-normal text-muted-foreground">· {g.relationship}</span>
                  </p>
                </div>
                {!isAdmin ? (
                  <span
                    className="text-muted-foreground"
                    title={
                      g.receive_general_notifications ? "Receives every update" : "Own scans only"
                    }
                  >
                    {g.receive_general_notifications ? (
                      <Bell className="size-4" />
                    ) : (
                      <BellOff className="size-4" />
                    )}
                  </span>
                ) : (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      title={
                        g.receive_general_notifications
                          ? "Receives every update. Tap to limit to own scans"
                          : "Own scans only. Tap to send every update"
                      }
                      onClick={() => toggleNotify.mutate(g)}
                    >
                      {g.receive_general_notifications ? (
                        <Bell className="text-primary" />
                      ) : (
                        <BellOff className="text-muted-foreground" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setPass(g)}
                      aria-label="Show pass"
                    >
                      <QrCode />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove guardian"
                      onClick={() => {
                        if (confirm(`Remove ${g.name}? Their pass will stop working.`))
                          removeGuardian.mutate(g.id);
                      }}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </>
                )}
              </li>
            ))}
            {member.guardians.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No {terms.guardians.toLowerCase()} registered yet.
              </p>
            )}
          </ul>
          {isAdmin && (
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <EditStudent student={member} />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-destructive">
                    <Trash2 /> Remove {terms.member.toLowerCase()}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove {member.full_name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently deletes their record, every {terms.guardian.toLowerCase()}{" "}
                      pass and their gate history.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => removeMember.mutate()}>
                      Remove
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
      )}

      <Dialog open={!!pass} onOpenChange={(o) => !o && setPass(null)}>
        <DialogContent className="max-w-sm border-0 bg-transparent p-0 shadow-none">
          <DialogHeader className="sr-only">
            <DialogTitle>QR pass</DialogTitle>
            <DialogDescription>Guardian pass</DialogDescription>
          </DialogHeader>
          {pass && (
            <div className="space-y-3">
              <PassCard
                hash={pass.unique_qr_hash}
                guardianName={pass.name}
                relationship={pass.relationship}
                memberName={member.full_name}
                identifier={member.identifier_code}
                orgName={orgName}
                photoUrl={pass.photo_path ? photos[pass.photo_path] : null}
                guardianLabel={terms.guardian}
              />
              <Button
                variant="signal"
                className="w-full"
                onClick={async () => {
                  await navigator.clipboard.writeText(passUrl(pass.unique_qr_hash));
                  toast.success("Pass link copied");
                }}
              >
                Copy pass link
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </li>
  );
}

interface GDraft {
  key: string;
  name: string;
  relationship: string;
  email: string;
  photo: string | null;
  notify: boolean;
}
const blankG = (): GDraft => ({
  key: crypto.randomUUID(),
  name: "",
  relationship: "",
  email: "",
  photo: null,
  notify: false,
});

function AddMemberDialog({
  open,
  onOpenChange,
  orgId,
  terms,
  classes,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgId: string;
  terms: OrgTerms;
  classes: string[];
}) {
  const queryClient = useQueryClient();
  const branch = useBranch();
  const me = useMe().data;
  const [m, setM] = useState({
    full_name: "",
    identifier_code: "",
    parent: "",
    email: "",
    photo: null as string | null,
  });
  const [gs, setGs] = useState<GDraft[]>(() => [blankG()]);
  const [busy, setBusy] = useState(false);
  // Headquarters accounts see every campus, so they pick one here. Branch staff
  // are locked to their own campus by the database.
  const defaultBranch =
    branch.branchId ??
    (branch.branches.length === 1 ? branch.branches[0]?.id : null) ??
    branch.branches.find((b) => b.is_main)?.id ??
    branch.branches[0]?.id ??
    null;
  const picksBranch = me?.branchId === null && branch.branches.length > 1;
  const [targetBranch, setTargetBranch] = useState("");
  const chosenBranch = (picksBranch ? targetBranch || defaultBranch : defaultBranch) ?? null;

  const upd = (key: string, patch: Partial<GDraft>) =>
    setGs((list) => list.map((g) => (g.key === key ? { ...g, ...patch } : g)));

  // Photos are stored by the server: it creates the bucket if needed, so a new
  // school never sees "photo couldn't be uploaded".
  const savePhoto = useServerFn(uploadProfilePhoto);
  const emailPasses = useServerFn(sendMemberPassEmails);
  const checkEmails = useServerFn(checkGuardianEmails);
  const addMember = useServerFn(createMember);
  async function upload(kind: "member" | "guardian", id: string, dataUrl: string) {
    await savePhoto({ data: { kind, id, photo: dataUrl } });
  }

  async function save() {
    if (!chosenBranch) {
      toast.error(
        "This school has no campus set up yet, so a student can't be saved. Reload the page and try again, or contact support if it carries on.",
      );
      return;
    }
    const email = z.string().email();
    if (!m.full_name.trim() || !email.safeParse(m.email.trim()).success) {
      toast.error(
        `Enter the ${terms.member.toLowerCase()}'s name and a valid ${terms.ownerEmail.toLowerCase()}`,
      );
      return;
    }
    if (!m.photo) {
      toast.error(
        `Add a clear face photo of the ${terms.member.toLowerCase()}. Every profile needs a picture so the gate can check faces.`,
      );
      return;
    }
    const valid = gs.filter((g) => g.name.trim());
    if (valid.some((g) => !g.relationship.trim() || !email.safeParse(g.email.trim()).success)) {
      toast.error(`Each ${terms.guardian.toLowerCase()} needs a relationship and a valid email.`);
      return;
    }
    if (valid.some((g) => !g.photo)) {
      toast.error(
        `Add a face photo for every ${terms.guardian.toLowerCase()}. The gate checks the picture before letting anyone through.`,
      );
      return;
    }
    setBusy(true);
    let createdId: string | null = null;
    try {
      // Each email belongs to one person across GoGuard, guardians included.
      const { clashes } = await checkEmails({
        data: {
          guardians: valid.map((g) => ({
            email: g.email.trim().toLowerCase(),
            name: g.name.trim(),
          })),
        },
      });
      if (clashes.length) {
        toast.error(
          `${clashes[0]} is already used by another person in GoGuard. Each person needs their own email address.`,
        );
        return;
      }
      // Contacts are encrypted on the server before they are stored.
      const created = await addMember({
        data: {
          orgId,
          branchId: chosenBranch,
          fullName: m.full_name.trim(),
          identifierCode: m.identifier_code.trim(),
          parentName: m.parent.trim(),
          email: m.email.trim().toLowerCase(),
          guardians: valid.map((g) => ({
            name: g.name.trim(),
            relationship: g.relationship.trim(),
            email: g.email.trim().toLowerCase(),
            notify: g.notify,
          })),
        },
      });
      createdId = created.memberId;
      await upload("member", created.memberId, m.photo);
      for (const g of valid) {
        const savedGuardian = created.guardians.find(
          (row) => row.email === g.email.trim().toLowerCase(),
        );
        if (savedGuardian) await upload("guardian", savedGuardian.id, g.photo!);
      }
      if (created.skipped) {
        toast.error(
          `${created.skipped} ${terms.guardian.toLowerCase()} could not be added because their email is already used by someone else.`,
        );
      }
      // Each guardian receives their own barcode by email. A mail problem must
      // not undo the student that was just saved.
      let mailed = 0;
      try {
        const res = await emailPasses({
          data: { memberId: created.memberId, siteUrl: window.location.origin },
        });
        mailed = res.sent;
      } catch (err) {
        console.error("[members] could not email passes", err);
      }
      toast.success(
        mailed
          ? `${m.full_name} added. ${mailed} pass ${mailed === 1 ? "email" : "emails"} sent`
          : `${m.full_name} added`,
      );
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["counts"] });
      setM({ full_name: "", identifier_code: "", parent: "", email: "", photo: null });
      setGs([blankG()]);
      onOpenChange(false);
    } catch (err) {
      // Keep the directory clean: if any step fails, remove the half-saved student.
      if (createdId) await supabase.from("members").delete().eq("id", createdId);
      toast.error(
        err instanceof Error && err.message
          ? `Couldn't save: ${err.message}`
          : "Couldn't save. Check the details and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add {terms.member.toLowerCase()}</DialogTitle>
          <DialogDescription>
            Each {terms.guardian.toLowerCase()} receives a personal QR pass.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {picksBranch && (
            <Field label="Campus">
              <select
                aria-label="Campus"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={chosenBranch ?? ""}
                onChange={(e) => setTargetBranch(e.target.value)}
              >
                {branch.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="flex gap-4">
            <div className="shrink-0">
              <PhotoPicker
                value={m.photo}
                onChange={(photo) => setM((x) => ({ ...x, photo }))}
                label="Face photo"
                required
              />
              <p className="mt-1 w-24 text-center text-[11px] text-muted-foreground">
                Must have a picture
              </p>
            </div>
            <div className="flex-1 space-y-3">
              <Field label="Full name">
                <Input
                  value={m.full_name}
                  onChange={(e) => setM((x) => ({ ...x, full_name: e.target.value }))}
                />
              </Field>
              <Field label={terms.identifier}>
                {classes.length ? (
                  <ClassSelect
                    classes={classes}
                    value={m.identifier_code}
                    onChange={(identifier_code) => setM((x) => ({ ...x, identifier_code }))}
                    placeholder={`Choose ${terms.identifier.toLowerCase()}`}
                  />
                ) : (
                  <Input
                    value={m.identifier_code}
                    onChange={(e) => setM((x) => ({ ...x, identifier_code: e.target.value }))}
                  />
                )}
              </Field>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`${terms.owner} name`}>
              <Input
                value={m.parent}
                onChange={(e) => setM((x) => ({ ...x, parent: e.target.value }))}
              />
            </Field>
            <Field label={terms.ownerEmail}>
              <Input
                type="email"
                value={m.email}
                onChange={(e) => setM((x) => ({ ...x, email: e.target.value }))}
              />
            </Field>
          </div>

          {gs.map((g, i) => (
            <div key={g.key} className="rounded-2xl border p-3">
              <p className="mb-2 text-sm font-semibold">
                {terms.guardian} {i + 1}
              </p>
              <div className="flex gap-3">
                <PhotoPicker
                  value={g.photo}
                  onChange={(photo) => upd(g.key, { photo })}
                  label="Face photo"
                  required
                  className="size-20"
                />
                <div className="grid flex-1 gap-2">
                  <Input
                    placeholder="Name"
                    value={g.name}
                    onChange={(e) => upd(g.key, { name: e.target.value })}
                  />
                  <Input
                    placeholder="Relationship"
                    list="relationships"
                    value={g.relationship}
                    onChange={(e) => upd(g.key, { relationship: e.target.value })}
                  />
                  <Input
                    placeholder="Email"
                    type="email"
                    value={g.email}
                    onChange={(e) => upd(g.key, { email: e.target.value })}
                  />
                </div>
              </div>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <Switch checked={g.notify} onCheckedChange={(v) => upd(g.key, { notify: v })} />{" "}
                Send every gate update
              </label>
            </div>
          ))}
          <datalist id="relationships">
            {terms.relationships.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          {gs.length < MAX_GUARDIANS && (
            <Button
              variant="outline"
              className="w-full border-dashed"
              onClick={() => setGs((l) => [...l, blankG()])}
            >
              <Plus /> Add {terms.guardian.toLowerCase()}
            </Button>
          )}
          <Button variant="signal" className="w-full" onClick={save} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Save and create passes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  orgId,
  terms,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgId: string;
  terms: OrgTerms;
}) {
  const queryClient = useQueryClient();
  const branch = useBranch();
  const addMember = useServerFn(createMember);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    const branchId =
      branch.branchId ?? (branch.branches.length === 1 ? branch.branches[0]?.id : null);
    if (!branchId) {
      toast.error("Select a branch before importing students.");
      return;
    }
    setBusy(true);
    try {
      const rows = parseCsv(await file.text());
      const groups = new Map<string, Record<string, string>[]>();
      for (const r of rows) {
        if (!r["full_name"] || !r["parent_email"]) continue;
        const key = `${r["full_name"].toLowerCase()}|${r["parent_email"].toLowerCase()}`;
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      let members = 0;
      let guardians = 0;
      let skipped = 0;
      for (const list of groups.values()) {
        const first = list[0]!;
        // The server encrypts the contacts and refuses an address that already
        // belongs to someone else, so the file never reaches the database as
        // plain text.
        const rows = list
          .filter((r) => r["guardian_name"] && r["guardian_email"])
          .slice(0, MAX_GUARDIANS)
          .map((r) => ({
            name: r["guardian_name"]!,
            relationship: r["guardian_relationship"] || "Guardian",
            email: r["guardian_email"]!.toLowerCase(),
            notify: /^(yes|true|1|y)$/i.test(r["general_notifications"] ?? ""),
          }));
        try {
          const created = await addMember({
            data: {
              orgId,
              branchId,
              fullName: first["full_name"]!,
              identifierCode: first["identifier_code"] || first["class"] || "",
              parentName: first["parent_name"] || "",
              email: first["parent_email"]!.toLowerCase(),
              guardians: rows,
            },
          });
          members++;
          guardians += created.guardians.length;
          skipped += created.skipped;
        } catch {
          continue;
        }
      }
      toast.success(
        `Imported ${members} ${terms.members.toLowerCase()} and ${guardians} ${terms.guardians.toLowerCase()}${
          skipped ? `, skipped ${skipped} with an email already in use` : ""
        }`,
      );
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["counts"] });
      onOpenChange(false);
    } catch {
      toast.error("We couldn't read that file. Please use the template format.");
    } finally {
      setBusy(false);
    }
  }

  const template =
    "full_name,identifier_code,parent_name,parent_email,guardian_name,guardian_relationship,guardian_email,general_notifications\n" +
    "Ada Obi,Grade 3B,Ngozi Obi,ngozi@example.com,Tunde Obi,Father,tunde@example.com,yes\n" +
    "Ada Obi,Grade 3B,Ngozi Obi,ngozi@example.com,Mary Ade,Nanny,mary@example.com,no";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk upload {terms.members.toLowerCase()}</DialogTitle>
          <DialogDescription>
            Add one row per {terms.guardian.toLowerCase()}. Rows with the same name and{" "}
            {terms.ownerEmail.toLowerCase()} are grouped together. You can add photos afterwards.
          </DialogDescription>
        </DialogHeader>
        <pre className="overflow-x-auto rounded-xl bg-muted p-3 font-mono text-[11px] leading-relaxed">
          {template}
        </pre>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              const blob = new Blob([template], { type: "text/csv" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "gatepass-template.csv";
              a.click();
            }}
          >
            Download template
          </Button>
          <label className="flex-1">
            <span
              className={cn(
                "inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-gradient-signal px-4 text-sm font-semibold text-signal-foreground",
                busy && "opacity-60",
              )}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}{" "}
              Choose CSV file
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void onFile(f);
              }}
            />
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
