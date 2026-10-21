"use client";

import {
  type Branch,
  createInvitationSchema,
  type Invitation,
  type Member,
  ROLE_RANK,
  ROLES,
  type Role,
} from "@idea01/schemas";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";
import {
  cancelInvitationAction,
  inviteAction,
  removeMemberAction,
  updateMemberAction,
} from "@/app/actions/team";
import { Banner, Button, Card, Field, Input, Pill, Select } from "@/components/ui";
import { errorText, SESSION_ERRORS } from "@/lib/error-text";
import { localizedErrors, localizedFieldErrors, newKey } from "@/lib/form";

interface Props {
  orgId: string;
  myUserId: string;
  myRole: Role;
  /** True when the signed-in person is limited to some branches: they may only share those. */
  scoped: boolean;
  branches: Branch[];
  members: Member[];
  invitations: Invitation[];
}

export function TeamManager({ orgId, myUserId, myRole, scoped, branches, members, invitations }: Props) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [banner, setBanner] = useState<{ tone: "warn" | "info"; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const assignable = ROLES.filter((r) => r !== "owner" && ROLE_RANK[r] < ROLE_RANK[myRole]);
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "";
  const access = (m: { branchIds: string[] }) =>
    m.branchIds.length ? m.branchIds.map(branchName).filter(Boolean).join(", ") : t("team.allBranches");

  /** Runs a team action and shows the translated error if it fails. */
  function act(
    run: () => Promise<{ ok: true } | { ok: false; code: string; message: string; retryAfter?: number }>,
    onOk?: () => void,
  ) {
    setBanner(null);
    start(async () => {
      const r = await run();
      if (r.ok) {
        onOk?.();
        return router.refresh();
      }
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setBanner({ tone: "warn", text: errorText(t, r) });
    });
  }

  // ---------- invite form ----------
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>(assignable[0] ?? "auditor");
  const [allBranches, setAllBranches] = useState(!scoped);
  const [picked, setPicked] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const key = useRef(newKey());

  function invite(e: FormEvent) {
    e.preventDefault();
    const branchIds = allBranches ? [] : picked;
    const parsed = createInvitationSchema.safeParse({ phone, role, branchIds });
    const errs = parsed.success ? {} : localizedErrors(t, parsed.error);
    if (!allBranches && picked.length === 0) errs.branchIds = t("validation.required");
    setErrors(errs);
    setBanner(null);
    if (Object.keys(errs).length) return;
    start(async () => {
      const r = await inviteAction(orgId, { phone, role, branchIds }, key.current);
      if (r.ok) {
        setBanner({ tone: "info", text: t("team.inviteSent", { phone: r.data.phone }) });
        setPhone("");
        setPicked([]);
        key.current = newKey();
        return router.refresh();
      }
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setErrors(localizedFieldErrors(t, r.fieldErrors));
      setBanner({ tone: "warn", text: errorText(t, r) });
      if (r.code !== "IDEMPOTENCY_IN_PROGRESS") key.current = newKey();
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold">{t("team.title")}</h1>
        <p className="mt-1 text-ink/80">{t("team.sub")}</p>
      </div>

      {banner && (
        <Banner tone={banner.tone} role={banner.tone === "warn" ? "alert" : "status"}>
          {banner.text}
        </Banner>
      )}

      <Card>
        <h2 className="text-xl font-bold">{t("team.inviteTitle")}</h2>
        {assignable.length === 0 ? (
          <p className="mt-2 text-ink/75">{t("team.noRoles")}</p>
        ) : (
          <form noValidate onSubmit={invite}>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label={t("team.phone")} htmlFor="invite-phone" error={errors.phone}>
                <Input
                  id="invite-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={14}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ""))}
                  aria-invalid={!!errors.phone}
                />
              </Field>
              <Field label={t("team.role")} htmlFor="invite-role" error={errors.role}>
                <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {assignable.map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <fieldset className="mt-4">
              <legend className="mb-2 text-sm font-semibold">{t("team.branches")}</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <label className="flex items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={allBranches}
                    disabled={scoped}
                    onChange={(e) => setAllBranches(e.target.checked)}
                  />
                  {t("team.allBranches")}
                </label>
                {!allBranches &&
                  branches.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 font-semibold">
                      <input
                        type="checkbox"
                        checked={picked.includes(b.id)}
                        onChange={(e) =>
                          setPicked(e.target.checked ? [...picked, b.id] : picked.filter((x) => x !== b.id))
                        }
                      />
                      {b.name}
                    </label>
                  ))}
              </div>
              {errors.branchIds && (
                <p
                  role="alert"
                  className="mt-2 inline-block rounded-chip border-2 border-ink bg-volt px-2.5 py-1 text-sm font-semibold"
                >
                  ! {errors.branchIds}
                </p>
              )}
            </fieldset>
            <Button type="submit" className="mt-5" disabled={pending}>
              {pending ? t("team.sending") : t("team.sendInvite")}
            </Button>
          </form>
        )}
      </Card>

      <section aria-labelledby="members-title">
        <h2 id="members-title" className="text-xl font-bold">
          {t("team.members")}
        </h2>
        <ul className="mt-3 space-y-3">
          {members.map((m) => {
            const isMe = m.userId === myUserId;
            const editable = !isMe && m.role !== "owner" && ROLE_RANK[m.role] < ROLE_RANK[myRole];
            const name = m.displayName ?? m.phone ?? t("team.unnamed");
            return (
              <li
                key={m.membershipId}
                className="rounded-card border-[2.5px] border-ink bg-paper p-4 shadow-hard-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold">
                      {name} {isMe && <Pill tone="volt">{t("team.you")}</Pill>}
                    </p>
                    {m.displayName && m.phone && <p className="text-sm text-ink/75">{m.phone}</p>}
                    <p className="mt-1 text-sm">{access(m)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {m.status === "suspended" && <Pill tone="ink">{t("team.suspended")}</Pill>}
                    {editable ? (
                      <Select
                        aria-label={`${t("team.role")}: ${name}`}
                        value={m.role}
                        disabled={pending}
                        className="min-h-10 w-auto py-1 text-sm font-semibold"
                        onChange={(e) =>
                          act(() => updateMemberAction(orgId, m.membershipId, { role: e.target.value }))
                        }
                      >
                        {assignable.map((r) => (
                          <option key={r} value={r}>
                            {t(`roles.${r}`)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Pill>{t(`roles.${m.role}`)}</Pill>
                    )}
                  </div>
                </div>
                {editable && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      small
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        act(() =>
                          updateMemberAction(orgId, m.membershipId, {
                            status: m.status === "active" ? "suspended" : "active",
                          }),
                        )
                      }
                    >
                      {m.status === "active" ? t("team.suspend") : t("team.restore")}
                    </Button>
                    {confirmRemove === m.membershipId ? (
                      <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
                        <span className="text-sm font-semibold">{t("team.removeConfirm", { name })}</span>
                        <Button
                          small
                          disabled={pending}
                          onClick={() =>
                            act(
                              () => removeMemberAction(orgId, m.membershipId),
                              () => setConfirmRemove(null),
                            )
                          }
                        >
                          {t("team.yesRemove")}
                        </Button>
                        <Button small variant="secondary" onClick={() => setConfirmRemove(null)}>
                          {t("team.keep")}
                        </Button>
                      </fieldset>
                    ) : (
                      <Button small variant="ghost" onClick={() => setConfirmRemove(m.membershipId)}>
                        {t("team.removeMember")}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="pending-title">
        <h2 id="pending-title" className="text-xl font-bold">
          {t("team.pending")}
        </h2>
        {invitations.length === 0 ? (
          <p className="mt-2 text-ink/75">{t("team.noPending")}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {invitations.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-card border-[2.5px] border-ink bg-paper p-4"
              >
                <div>
                  <p className="font-bold">{i.phone}</p>
                  <p className="text-sm">
                    {t(`roles.${i.role}`)} · {access(i)} ·{" "}
                    {t("team.expires", { date: new Date(i.expiresAt).toLocaleDateString() })}
                  </p>
                </div>
                {ROLE_RANK[i.role] < ROLE_RANK[myRole] && (
                  <Button
                    small
                    variant="secondary"
                    disabled={pending}
                    onClick={() => act(() => cancelInvitationAction(orgId, i.id))}
                  >
                    {t("team.cancelInvite")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
