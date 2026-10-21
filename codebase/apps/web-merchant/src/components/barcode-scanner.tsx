"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Banner, Button, Field, Input } from "./ui";

interface Detector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
interface DetectorCtor {
  new (opts?: { formats?: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
}
const detectorCtor = (): DetectorCtor | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;

const WANTED = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];

/**
 * Find a code by camera (where the browser can read barcodes), or by typing it. A USB or Bluetooth scanner works too:
 * it "types" the digits and presses Enter. The same code is not reported twice within two seconds.
 */
// The Find button stays enabled while a scan is processed: a disabled default button would also block Enter, and a USB
// scanner presses Enter after every code. Callers queue their work instead.
export function BarcodeScanner({ onCode, busy }: { onCode: (code: string) => void; busy?: boolean }) {
  const t = useTranslations("scanner");
  const [camera, setCamera] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => setSupported(!!detectorCtor() && !!navigator.mediaDevices?.getUserMedia), []);

  useEffect(() => {
    if (!camera) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const Ctor = detectorCtor();
        if (!Ctor) throw new Error("unsupported");
        const formats = Ctor.getSupportedFormats
          ? (await Ctor.getSupportedFormats()).filter((f) => WANTED.includes(f))
          : WANTED;
        const detector = new Ctor({ formats });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (stopped) {
          for (const tr of stream.getTracks()) tr.stop();
          return;
        }
        const el = video.current;
        if (!el) return;
        el.srcObject = stream;
        await el.play();
        const tick = async () => {
          if (stopped) return;
          try {
            const found = await detector.detect(el);
            const code = found[0]?.rawValue;
            if (code && !(last.current.code === code && Date.now() - last.current.at < 2000)) {
              last.current = { code, at: Date.now() };
              onCodeRef.current(code);
            }
          } catch {
            // a frame that cannot be read is simply skipped
          }
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch (err) {
        setProblem((err as Error).name === "NotAllowedError" ? t("denied") : t("noCamera"));
        setCamera(false);
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((tr) => {
        tr.stop();
      });
    };
  }, [camera, t]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("code") as HTMLInputElement;
    const code = input.value.trim();
    if (!code) return;
    input.value = "";
    onCodeRef.current(code);
    input.focus();
  }

  return (
    <div>
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
        <Field label={t("label")} htmlFor="scan-code" hint={t("hint")} className="min-w-0 flex-1">
          <Input
            id="scan-code"
            name="code"
            autoFocus
            autoComplete="off"
            inputMode="text"
            enterKeyHint="search"
            maxLength={64}
          />
        </Field>
        <Button type="submit" aria-busy={busy}>
          {t("find")}
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {supported ? (
          <Button
            type="button"
            variant="secondary"
            small
            onClick={() => (setProblem(null), setCamera((c) => !c))}
            aria-pressed={camera}
          >
            {camera ? t("cameraOff") : t("cameraOn")}
          </Button>
        ) : (
          <span className="text-sm text-ink/80">{t("noScannerSupport")}</span>
        )}
      </div>
      {problem && (
        <Banner tone="warn" role="alert" className="mt-3">
          {problem}
        </Banner>
      )}
      {camera && (
        <div className="mt-3 overflow-hidden rounded-card border-[2.5px] border-ink bg-ink">
          {/* biome-ignore lint/a11y/useMediaCaption: a live camera preview has no audio or captions */}
          <video
            ref={video}
            playsInline
            muted
            className="aspect-[4/3] w-full object-cover"
            aria-label={t("preview")}
          />
        </div>
      )}
    </div>
  );
}
