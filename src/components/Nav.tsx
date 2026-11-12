"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const links = [
    { href: "/discover", label: "Discover" },
    { href: "/", label: "My feed" },
    { href: "/competitors", label: "Accounts" },
    { href: "/account", label: "Plan" },
    ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <nav className="order-3 flex basis-full flex-nowrap items-center gap-2 overflow-x-auto pb-1 sm:order-2 sm:basis-auto sm:flex-wrap sm:overflow-visible sm:pb-0" aria-label="Main">
      {links.map((l) => {
        const active =
          l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className="sl-pill shrink-0 whitespace-nowrap"
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
