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
import StarLogo, { STAR_LABS_INSTAGRAM, STAR_LABS_SITE } from "@/components/StarLogo";

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
        <header className="z-30 border-b-[2.5px] sm:sticky sm:top-0 bg-[var(--bg)]/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:py-3">
            <Link href="/" className="order-1 flex items-center gap-3" aria-label="Star Labs Reel Radar home">
              <StarLogo size={28} />
              <span className="sl-label hidden rounded-full border-2 px-2.5 py-0.5 sm:inline-block">
                <span style={{ color: "var(--hot)" }}>●</span> Reel Radar
              </span>
            </Link>
            {user ? (
              <>
                <Nav isAdmin={user.isAdmin} />
                <div className="order-2 ml-auto flex items-center gap-3 sm:order-3">
                  <Link
                    href="/account"
                    className="sl-tag"
                    style={{ background: "var(--warm)" }}
                    title={`${user.isAdmin ? "Admin" : user.planInfo.name} plan`}
                  >
                    {user.isAdmin ? "Admin" : user.planInfo.name}
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
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <a href={STAR_LABS_SITE} target="_blank" rel="noopener noreferrer" aria-label="Star Labs website">
                <StarLogo size={30} onDark />
              </a>
              <p className="sl-label text-white/80">
                Build something people can&apos;t ignore.
              </p>
            </div>
            <nav className="sl-label flex items-center gap-5 text-white" aria-label="Star Labs links">
              <a
                href={STAR_LABS_SITE}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-[var(--accent)] decoration-2 underline-offset-4 hover:text-[var(--accent)]"
              >
                starlabsstudio.com
              </a>
              <a
                href={STAR_LABS_INSTAGRAM}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-[var(--accent)] decoration-2 underline-offset-4 hover:text-[var(--accent)]"
              >
                Instagram @starlabs.ai
              </a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
