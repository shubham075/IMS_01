"use client";

import { normalizeIndianPhone, type OtpChannel } from "@idea01/schemas";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { requestOtpAction, verifyOtpAction } from "@/app/actions/auth";
import { Banner, Button, Field, Input } from "@/components/ui";
import { errorText } from "@/lib/error-text";

export function LoginForm({ devCode }: { devCode: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [terms, setTerms] = useState(false);
  const [code, setCode] = useState("");
  const [channel, setChannel] = useState<OtpChannel>("sms");
  const [requested, setRequested] = useState<OtpChannel>("sms");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ phone?: string; terms?: string; code?: string }>({});
  const codeRef = useRef<HTMLInputElement>(null);

  // Tick once a second while waiting on the code screen, for the "send a new code in Ns" countdown.
  useEffect(() => {
    if (step !== "code") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step]);
  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const normalized = normalizeIndianPhone(phone);
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const channelName = (c: OtpChannel) => t(`login.channel.${c}`);

  function send(wanted: OtpChannel) {
    const fe: typeof fieldErrors = {};
    if (!normalized) fe.phone = t("validation.phone");
    if (!terms) fe.terms = t("login.termsRequired");
    setFieldErrors(fe);
    setError(null);
    if (!normalized || !terms) return;
    start(async () => {
      const r = await requestOtpAction({ phone: normalized, channel: wanted });
      if (!r.ok) return setError(errorText(t, r));
      setRequested(wanted);
      setChannel(r.data.channel);
      setNow(Date.now());
      setResendAt(Date.now() + r.data.resendAfterSeconds * 1000);
      setCode("");
      setStep("code");
    });
  }

  function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) return setFieldErrors({ code: t("validation.code") });
    setFieldErrors({});
    start(async () => {
      const r = await verifyOtpAction({ phone: normalized, code, acceptTerms: true });
      if (!r.ok) {
        setError(errorText(t, r));
        setCode("");
        codeRef.current?.focus();
        return;
      }
      router.replace(r.data.redirectTo);
      router.refresh();
    });
  }

  if (step === "phone") {
    return (
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          send("sms");
        }}
      >
        <h1 className="text-2xl font-extrabold">{t("login.title")}</h1>
        <p className="mt-1 text-ink/80">{t("login.sub")}</p>
        {error && (
          <Banner tone="warn" role="alert" className="mt-4">
            {error}
          </Banner>
        )}
        <Field
          label={t("login.phoneLabel")}
          htmlFor="phone"
          hint={t("login.phoneHelp")}
          error={fieldErrors.phone}
        >
          <div className="flex gap-2">
            <span
              className="grid min-h-12 w-16 place-items-center rounded-control border-[2.5px] border-ink bg-paper font-bold"
              aria-hidden="true"
            >
              +91
            </span>
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={14}
              placeholder="98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ""))}
              aria-invalid={!!fieldErrors.phone}
              aria-describedby={fieldErrors.phone ? "phone-error" : undefined}
              autoFocus
            />
          </div>
        </Field>
        <div className="mt-5">
          <label className="flex cursor-pointer items-start gap-3 font-semibold">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              aria-invalid={!!fieldErrors.terms}
              className="mt-0.5"
            />
            <span>{t("login.terms")}</span>
          </label>
          {fieldErrors.terms && (
            <p
              role="alert"
              className="mt-1.5 inline-block rounded-chip border-2 border-ink bg-volt px-2.5 py-1 text-sm font-semibold"
            >
              ! {fieldErrors.terms}
            </p>
          )}
        </div>
        <Button type="submit" className="mt-6 w-full" disabled={pending}>
          {pending ? t("login.sending") : `${t("login.sendCode")} →`}
        </Button>
        <p className="mt-4 text-sm text-ink/75">{t("login.newHere")}</p>
      </form>
    );
  }

  return (
    <form noValidate onSubmit={verify}>
      <h1 className="text-2xl font-extrabold">{t("login.codeTitle")}</h1>
      <p className="mt-1">
        {t("login.sentVia", { phone: `+91 ${normalized?.slice(3)}`, channel: channelName(channel) })}
      </p>
      {channel !== requested && (
        <Banner tone="info" role="status" className="mt-3">
          {t("login.failover", { from: channelName(requested), to: channelName(channel) })}
        </Banner>
      )}
      {devCode && <Banner className="mt-3">{t("login.devHint", { code: devCode })}</Banner>}
      {error && (
        <Banner tone="warn" role="alert" className="mt-3">
          {error}
        </Banner>
      )}
      <Field label={t("login.codeLabel")} htmlFor="code" error={fieldErrors.code}>
        <Input
          ref={codeRef}
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          aria-invalid={!!fieldErrors.code}
          className="text-center text-2xl font-bold tracking-[0.5em]"
        />
      </Field>
      <Button type="submit" className="mt-5 w-full" disabled={pending}>
        {pending ? t("login.verifying") : t("login.verify")}
      </Button>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          small
          variant="secondary"
          disabled={pending || secondsLeft > 0}
          onClick={() => send(requested)}
        >
          {secondsLeft > 0 ? t("login.resendIn", { seconds: secondsLeft }) : t("login.resend")}
        </Button>
        {channel !== "whatsapp" && (
          <Button small variant="secondary" disabled={pending} onClick={() => send("whatsapp")}>
            {t("login.tryWhatsapp")}
          </Button>
        )}
        {channel !== "voice" && (
          <Button small variant="secondary" disabled={pending} onClick={() => send("voice")}>
            {t("login.tryCall")}
          </Button>
        )}
        <Button
          small
          variant="ghost"
          onClick={() => {
            setStep("phone");
            setError(null);
            setCode("");
          }}
        >
          {t("login.changeNumber")}
        </Button>
      </div>
    </form>
  );
}
