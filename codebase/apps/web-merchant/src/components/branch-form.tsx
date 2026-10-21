"use client";

import { type Branch, createBranchSchema, type Location } from "@idea01/schemas";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { createBranchAction, updateBranchAction } from "@/app/actions/org";
import { errorText, SESSION_ERRORS } from "@/lib/error-text";
import { clean, localizedErrors, localizedFieldErrors, newKey } from "@/lib/form";
import { defaultHours, type HoursState, hoursFromApi, hoursToApi } from "@/lib/hours";
import { HoursEditor } from "./hours-editor";
import { LocationPicker } from "./location-picker";
import { Banner, Button, Card, Field, Input } from "./ui";

interface Props {
  orgId: string;
  tileUrl: string;
  /** Present when editing. */
  branch?: Branch;
  /** Where to go after creating a branch. */
  nextPath: string;
}

export function BranchForm({ orgId, tileUrl, branch, nextPath }: Props) {
  const t = useTranslations();
  const router = useRouter();
  const editing = !!branch;
  const [pending, start] = useTransition();
  const [location, setLocation] = useState<Location | null>(branch?.location ?? null);
  const [hours, setHours] = useState<HoursState>(branch ? hoursFromApi(branch.hours) : defaultHours());
  const [whatsapp, setWhatsapp] = useState(branch?.contactOptions.includes("whatsapp") ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ text: string; ref?: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const idempotencyKey = useRef(newKey());

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = {
      ...clean({
        name: fd.get("name"),
        addressLine: fd.get("addressLine"),
        area: fd.get("area"),
        city: fd.get("city"),
        state: fd.get("state"),
        pincode: fd.get("pincode"),
        phonePublic: fd.get("phonePublic"),
      }),
      contactOptions: whatsapp ? ["call", "whatsapp"] : ["call"],
      hours: hoursToApi(hours),
      ...(location ? { location } : {}),
    };
    setBanner(null);
    setSaved(false);
    const parsed = createBranchSchema.safeParse(raw);
    if (!parsed.success) {
      const errs = localizedErrors(t, parsed.error);
      const hoursMsg = Object.entries(errs).find(([k]) => k.startsWith("hours"))?.[1];
      const locMsg = errs["location.lat"] ?? errs["location.lng"];
      return setErrors({
        ...errs,
        ...(hoursMsg ? { hours: hoursMsg } : {}),
        ...(locMsg ? { location: locMsg } : {}),
      });
    }
    setErrors({});
    start(async () => {
      const r = editing
        ? await updateBranchAction(orgId, branch.id, raw)
        : await createBranchAction(orgId, raw, idempotencyKey.current);
      if (r.ok) {
        if (editing) {
          setSaved(true);
          return router.refresh();
        }
        return router.push(nextPath);
      }
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setErrors(localizedFieldErrors(t, r.fieldErrors));
      setBanner({ text: errorText(t, r), ref: r.code === "INTERNAL_ERROR" ? r.traceId : undefined });
      if (!editing && r.code !== "IDEMPOTENCY_IN_PROGRESS") idempotencyKey.current = newKey();
    });
  }

  return (
    <Card>
      <form noValidate onSubmit={submit}>
        <h1 className="text-2xl font-extrabold">
          {editing ? t("branchForm.editTitle") : t("branchForm.createTitle")}
        </h1>
        {!editing && <p className="mt-1 text-ink/80">{t("branchForm.createSub")}</p>}
        {banner && (
          <Banner tone="warn" role="alert" className="mt-4">
            {banner.text}
            {banner.ref && (
              <span className="mt-1 block text-xs">{t("common.reference", { id: banner.ref })}</span>
            )}
          </Banner>
        )}
        {saved && (
          <Banner role="status" className="mt-4">
            {t("branchForm.saved")}
          </Banner>
        )}

        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field
            label={t("branchForm.name")}
            htmlFor="name"
            hint={t("branchForm.nameHelp")}
            error={errors.name}
          >
            <Input
              id="name"
              name="name"
              defaultValue={branch?.name}
              aria-invalid={!!errors.name}
              autoFocus={!editing}
            />
          </Field>
          <Field label={t("branchForm.area")} htmlFor="area" error={errors.area}>
            <Input id="area" name="area" defaultValue={branch?.area ?? ""} autoComplete="address-level3" />
          </Field>
        </div>
        <Field label={t("branchForm.address")} htmlFor="addressLine" error={errors.addressLine}>
          <Input
            id="addressLine"
            name="addressLine"
            defaultValue={branch?.addressLine ?? ""}
            autoComplete="street-address"
            aria-invalid={!!errors.addressLine}
          />
        </Field>
        <div className="grid gap-x-4 sm:grid-cols-3">
          <Field label={t("branchForm.city")} htmlFor="city" error={errors.city}>
            <Input id="city" name="city" defaultValue={branch?.city ?? ""} autoComplete="address-level2" />
          </Field>
          <Field label={t("branchForm.state")} htmlFor="state" error={errors.state}>
            <Input id="state" name="state" defaultValue={branch?.state ?? ""} autoComplete="address-level1" />
          </Field>
          <Field label={t("branchForm.pincode")} htmlFor="pincode" error={errors.pincode}>
            <Input
              id="pincode"
              name="pincode"
              inputMode="numeric"
              maxLength={6}
              defaultValue={branch?.pincode ?? ""}
              autoComplete="postal-code"
              aria-invalid={!!errors.pincode}
            />
          </Field>
        </div>

        <section className="mt-7" aria-labelledby="map-title">
          <h2 id="map-title" className="text-lg font-bold">
            {t("branchForm.mapTitle")}
          </h2>
          <p className="mb-3 text-sm text-ink/75">{t("branchForm.mapHelp")}</p>
          <LocationPicker value={location} onChange={setLocation} tileUrl={tileUrl} />
          {errors.location && (
            <p
              role="alert"
              className="mt-2 inline-block rounded-chip border-2 border-ink bg-volt px-2.5 py-1 text-sm font-semibold"
            >
              ! {errors.location}
            </p>
          )}
        </section>

        <section className="mt-7" aria-labelledby="hours-title">
          <h2 id="hours-title" className="mb-1 text-lg font-bold">
            {t("branchForm.hoursTitle")}
          </h2>
          <HoursEditor value={hours} onChange={setHours} errors={errors} />
        </section>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field
            label={
              <>
                {t("branchForm.phonePublic")}{" "}
                <span className="font-normal text-ink/70">({t("common.optional")})</span>
              </>
            }
            htmlFor="phonePublic"
            error={errors.phonePublic}
          >
            <Input
              id="phonePublic"
              name="phonePublic"
              type="tel"
              inputMode="numeric"
              maxLength={14}
              defaultValue={branch?.phonePublic?.replace("+91", "") ?? ""}
              autoComplete="off"
              aria-invalid={!!errors.phonePublic}
            />
          </Field>
          <div className="mt-4 flex items-end pb-3">
            <label className="flex cursor-pointer items-center gap-3 font-semibold">
              <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} />
              {t("branchForm.whatsapp")}
            </label>
          </div>
        </div>

        <Button type="submit" className="mt-7 w-full sm:w-auto" disabled={pending}>
          {pending
            ? t("branchForm.saving")
            : `${editing ? t("branchForm.submitUpdate") : t("branchForm.submitCreate")} →`}
        </Button>
      </form>
    </Card>
  );
}
