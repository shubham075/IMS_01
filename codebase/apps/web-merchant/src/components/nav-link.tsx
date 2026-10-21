"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function NavLink({
  href,
  children,
  exact,
}: {
  href: string;
  children: React.ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-10 items-center rounded-control border-[2.5px] px-4 font-bold focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink",
        active ? "border-ink bg-volt shadow-hard-sm" : "border-transparent hover:bg-grey/50",
      )}
    >
      {children}
    </Link>
  );
}
