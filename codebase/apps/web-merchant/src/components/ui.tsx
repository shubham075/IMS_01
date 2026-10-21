import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Design-system components (design/DESIGN_SYSTEM.md): flat bold, four colours, 48px touch targets. */

type Variant = "primary" | "secondary" | "ghost";
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-control border-[2.5px] border-ink font-bold transition-[transform,box-shadow,background-color] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink";
const BUTTON_VARIANT: Record<Variant, string> = {
  primary:
    "bg-ink text-paper shadow-hard-sm hover:bg-volt hover:text-ink active:translate-x-[3px] active:translate-y-[3px] active:shadow-none",
  secondary:
    "bg-paper text-ink shadow-hard-sm hover:bg-grey active:translate-x-[3px] active:translate-y-[3px] active:shadow-none",
  ghost: "border-transparent bg-transparent text-ink underline hover:bg-grey/40",
};

export function Button({
  variant = "primary",
  small,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; small?: boolean }) {
  return (
    <button
      type={type}
      className={cn(
        BUTTON_BASE,
        BUTTON_VARIANT[variant],
        small ? "min-h-9 px-3 py-1 text-sm" : "min-h-12 px-5 py-2",
        className,
      )}
      {...props}
    />
  );
}

const INPUT =
  "w-full min-h-12 rounded-control border-[2.5px] border-ink bg-paper px-3.5 py-2.5 text-ink placeholder:text-ink/55 focus:shadow-volt focus:outline-none aria-[invalid=true]:bg-volt disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(INPUT, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(INPUT, "pr-8", className)} {...props} />;
}

/** Label + control + hint + error. The error is announced to screen readers and never relies on colour alone ("!"). */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mt-4", className)}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1.5 text-sm text-ink/75">{hint}</p>}
      {error && <FieldError id={`${htmlFor}-error`}>{error}</FieldError>}
    </div>
  );
}

export function FieldError({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p
      id={id}
      role="alert"
      className="mt-1.5 inline-block rounded-chip border-2 border-ink bg-volt px-2.5 py-1 text-sm font-semibold"
    >
      ! {children}
    </p>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-card border-[2.5px] border-ink bg-paper p-5 shadow-hard sm:p-7", className)}
      {...props}
    />
  );
}

export function Banner({
  tone = "info",
  children,
  role,
  className,
}: {
  tone?: "info" | "warn";
  children: ReactNode;
  role?: "alert" | "status";
  className?: string;
}) {
  return (
    <div
      role={role}
      className={cn(
        "rounded-control border-[2.5px] border-ink px-4 py-3 text-sm",
        tone === "warn" ? "bg-volt" : "bg-grey",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Pill({
  children,
  tone = "grey",
  className,
}: {
  children: ReactNode;
  tone?: "grey" | "volt" | "ink";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block rounded-chip border-2 border-ink px-2.5 py-0.5 text-xs font-bold",
        tone === "volt" && "bg-volt",
        tone === "grey" && "bg-grey",
        tone === "ink" && "bg-ink text-paper",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "grid size-10 place-items-center rounded-control border-[2.5px] border-ink bg-ink font-black text-volt",
        className,
      )}
      aria-hidden="true"
    >
      i1
    </span>
  );
}
