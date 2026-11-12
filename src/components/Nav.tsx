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
    <nav className="flex flex-wrap items-center gap-2" aria-label="Main">
      {links.map((l) => {
        const active =
          l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className="sl-pill"
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
