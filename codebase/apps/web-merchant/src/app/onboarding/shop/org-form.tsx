"use client";

import { createOrgSchema, ORG_CATEGORIES, updateProfileSchema } from "@idea01/schemas";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { updateProfileAction } from "@/app/actions/auth";
import { createOrgAction } from "@/app/actions/org";
import { Banner, Button, Card, Field, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { errorText, SESSION_ERRORS } from "@/lib/error-text";
import { clean, localizedErrors, localizedFieldErrors, newKey } from "@/lib/form";

export function OrgForm() {
  const t = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [category, setCategory] = useState<string>("hardware");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ text: string; ref?: string } | null>(null);
  const idempotencyKey = useRef(newKey()); // one key per form: a double-click or retry cannot create two shops

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = clean({
      name: fd.get("name"),
      category,
      gstin: fd.get("gstin"),
      contactPhone: fd.get("contactPhone"),
    });
    const ownerName = clean({ displayName: fd.get("ownerName") }).displayName as string | undefined;
    const parsed = createOrgSchema.safeParse(raw);
    const nameCheck =
      ownerName === undefined ? null : updateProfileSchema.safeParse({ displayName: ownerName });
    setBanner(null);
    if (!parsed.success || (nameCheck && !nameCheck.success)) {
      const errs = parsed.success ? {} : localizedErrors(t, parsed.error);
      if (nameCheck && !nameCheck.success) errs.ownerName = t("validation.personName");
      return setErrors(errs);
    }
    setErrors({});
    start(async () => {
      const r = await createOrgAction(raw, idempotencyKey.current);
      if (r.ok) {
        if (ownerName) await updateProfileAction({ displayName: ownerName }); // best effort: the shop already exists
        return router.push("/onboarding/location");
      }
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setErrors(localizedFieldErrors(t, r.fieldErrors));
      setBanner({ text: errorText(t, r), ref: r.code === "INTERNAL_ERROR" ? r.traceId : undefined });
      if (r.code !== "IDEMPOTENCY_IN_PROGRESS") idempotencyKey.current = newKey();
    });
  }

  return (
    <Card>
      <form noValidate onSubmit={submit}>
        <h1 className="text-2xl font-extrabold">{t("shopForm.title")}</h1>
        <p className="mt-1 text-ink/80">{t("shopForm.sub")}</p>
        {banner && (
          <Banner tone="warn" role="alert" className="mt-4">
            {banner.text}
            {banner.ref && (
              <span className="mt-1 block text-xs">{t("common.reference", { id: banner.ref })}</span>
            )}
          </Banner>
        )}
        <Field
          label={
            <>
              {t("shopForm.yourName")}{" "}
              <span className="font-normal text-ink/70">({t("common.optional")})</span>
            </>
          }
          htmlFor="ownerName"
          hint={t("shopForm.yourNameHelp")}
          error={errors.ownerName}
        >
          <Input
            id="ownerName"
            name="ownerName"
            autoComplete="name"
            aria-invalid={!!errors.ownerName}
            autoFocus
          />
        </Field>
        <Field label={t("shopForm.name")} htmlFor="name" error={errors.name}>
          <Input
            id="name"
            name="name"
            autoComplete="organization"
            placeholder={t("shopForm.namePlaceholder")}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "name-error" : undefined}
          />
        </Field>

        <fieldset className="mt-5">
          <legend className="mb-2 text-sm font-semibold">{t("shopForm.category")}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {ORG_CATEGORIES.map((c) => (
              <label
                key={c}
                className={cn(
                  "flex min-h-14 cursor-pointer items-center rounded-card border-[2.5px] border-ink px-3 py-2 font-semibold has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink",
                  category === c ? "bg-volt shadow-hard-sm" : "bg-paper hover:bg-grey",
                )}
              >
                <input
                  type="radio"
                  name="category"
                  value={c}
                  checked={category === c}
                  onChange={() => setCategory(c)}
                  className="sr-only"
                />
                {t(`categories.${c}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {category === "pharmacy" && <Banner className="mt-3">{t("shopForm.pharmacyNote")}</Banner>}

        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field
            label={
              <>
                {t("shopForm.gstin")}{" "}
                <span className="font-normal text-ink/70">({t("common.optional")})</span>
              </>
            }
            htmlFor="gstin"
            hint={t("shopForm.gstinHelp")}
            error={errors.gstin}
          >
            <Input
              id="gstin"
              name="gstin"
              maxLength={15}
              placeholder="29ABCDE1234F1Z5"
              className="uppercase"
              aria-invalid={!!errors.gstin}
              autoCapitalize="characters"
            />
          </Field>
          <Field
            label={
              <>
                {t("shopForm.contactPhone")}{" "}
                <span className="font-normal text-ink/70">({t("common.optional")})</span>
              </>
            }
            htmlFor="contactPhone"
            hint={t("shopForm.contactHelp")}
            error={errors.contactPhone}
          >
            <Input
              id="contactPhone"
              name="contactPhone"
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              maxLength={14}
              aria-invalid={!!errors.contactPhone}
            />
          </Field>
        </div>

        <Button type="submit" className="mt-7 w-full sm:w-auto" disabled={pending}>
          {pending ? t("shopForm.submitting") : `${t("shopForm.submit")} →`}
        </Button>
      </form>
    </Card>
  );
}
