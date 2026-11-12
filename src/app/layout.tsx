import type { Metadata } from "next";
import Link from "next/link";
import {
  Bricolage_Grotesque,
  Instrument_Serif,
  JetBrains_Mono,
} from "next/font/google";
import "./globals.css";
import SignOut from "@/components/SignOut";
import { getUser } from "@/lib/session";
import Nav from "@/components/Nav";
import StarLogo from "@/components/StarLogo";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Reel Radar by Star Labs",
  description:
    "Find the Instagram reels that beat their own account's average, while the idea is still working.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // A database hiccup must not take the whole page down: fall back to the
  // signed-out header and let the page itself report the problem.
  let user = null;
  try {
    user = await getUser();
  } catch {
    user = null;
  }

  return (
    <html lang="en" className={`${display.variable} ${serif.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 border-b-[2.5px] bg-[var(--bg)]/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-3" aria-label="Star Labs Reel Radar home">
              <StarLogo />
              <span className="sl-label hidden rounded-full border-2 px-2.5 py-0.5 sm:inline-block">
                <span style={{ color: "var(--hot)" }}>●</span> Reel Radar
              </span>
            </Link>
            {user ? (
              <>
                <Nav isAdmin={user.isAdmin} />
                <div className="ml-auto flex items-center gap-3">
                  <Link
                    href="/account"
                    className="sl-tag nums"
                    style={{ background: "var(--warm)" }}
                    title={`${user.points} points · ${user.isAdmin ? "Admin" : user.planInfo.name} plan`}
                  >
                    ◆ {user.isAdmin ? "∞" : user.points} pts
                  </Link>
                  <SignOut />
                </div>
              </>
            ) : (
              <div className="ml-auto flex items-center gap-2">
                <Link href="/login" className="sl-pill">
                  Log in
                </Link>
                <Link href="/signup" className="sl-btn sl-btn-primary sl-btn-sm">
                  Sign up free
                </Link>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-10 pt-6">
          {children}
        </main>

        <footer className="border-t-[2.5px] bg-[var(--dark)] text-white">
          <div className="sl-halftone mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-6">
            <StarLogo size={30} onDark />
            <p className="sl-label text-white/80">
              Build something people can&apos;t ignore.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
