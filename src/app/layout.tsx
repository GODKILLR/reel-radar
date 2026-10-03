import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import SignOut from "@/components/SignOut";

export const metadata: Metadata = {
  title: "Reel Radar",
  description:
    "Track what your Instagram competitors are posting and which reels are going viral.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-30 border-b bg-[var(--bg)]/90 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: "var(--hot)" }}
                aria-hidden
              />
              Reel Radar
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/"
                className="rounded-md px-3 py-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
              >
                Feed
              </Link>
              <Link
                href="/competitors"
                className="rounded-md px-3 py-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
              >
                Competitors
              </Link>
            </nav>
            <SignOut />
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 py-5">{children}</main>
      </body>
    </html>
  );
}
