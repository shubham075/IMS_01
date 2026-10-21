"use client";

import { WEEKDAYS } from "@idea01/schemas";
import { useTranslations } from "next-intl";
import { type Day, type DayHours, type HoursState } from "@/lib/hours";
import { Button, FieldError, Input } from "./ui";

export function HoursEditor({
  value,
  onChange,
  errors,
}: {
  value: HoursState;
  onChange: (v: HoursState) => void;
  errors?: Record<string, string>;
}) {
  const t = useTranslations("branchForm");
  const set = (d: Day, patch: Partial<DayHours>) => onChange({ ...value, [d]: { ...value[d], ...patch } });
  return (
    <div>
      <ul className="divide-y-2 divide-ink/15">
        {WEEKDAYS.map((d) => (
          <li
            key={d}
            className="grid grid-cols-[3.5rem_1fr] items-center gap-x-3 gap-y-2 py-2 sm:grid-cols-[4rem_8rem_1fr]"
          >
            <span className="font-bold">{t(`days.${d}`)}</span>
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={value[d].on}
                onChange={(e) => set(d, { on: e.target.checked })}
              />
              {value[d].on ? t("open") : t("closed")}
            </label>
            {value[d].on && (
              <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                <Input
                  type="time"
                  value={value[d].from}
                  onChange={(e) => set(d, { from: e.target.value })}
                  aria-label={`${t(`days.${d}`)} ${t("open")}`}
                  className="max-w-36"
                />
                <span aria-hidden="true">–</span>
                <Input
                  type="time"
                  value={value[d].to}
                  onChange={(e) => set(d, { to: e.target.value })}
                  aria-label={`${t(`days.${d}`)} ${t("closed")}`}
                  className="max-w-36"
                />
              </div>
            )}
          </li>
        ))}
      </ul>
      <Button
        small
        variant="secondary"
        className="mt-3"
        onClick={() => onChange(Object.fromEntries(WEEKDAYS.map((d) => [d, { ...value.mon }])) as HoursState)}
      >
        {t("copyMonday")}
      </Button>
      {errors?.hours && (
        <div>
          <FieldError>{errors.hours}</FieldError>
        </div>
      )}
    </div>
  );
}
