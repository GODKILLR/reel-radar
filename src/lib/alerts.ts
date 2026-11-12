import { query } from "./db";
import { config } from "./config";

interface AlertRow {
  shortcode: string;
  username: string;
  url: string | null;
  views: string;
  outlier_score: string | null;
  caption: string | null;
}

/** Most reels listed in a single notification before it gets summarized. */
const MAX_LISTED = 8;

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export interface AlertOptions {
  /**
   * Claim the alerts without notifying. Used for the initial backfill: an
   * account's whole history crosses the threshold at once, and firing a few
   * hundred notifications on day one would be useless. Seeding the dedupe
   * table means only genuinely *new* outliers ping you from then on.
   */
  silent?: boolean;
}

/**
 * Finds newly-crossed outliers and notifies once each. `alerts` has a
 * UNIQUE (shortcode, kind) constraint, so a reel that stays viral across many
 * polls only pings on the poll where it first crossed.
 */
export async function dispatchOutlierAlerts(
  opts: AlertOptions = {}
): Promise<{ claimed: number; notified: number }> {
  // Claim first. If notification delivery fails we would rather miss a ping
  // than re-send the same reel on every subsequent poll.
  const claimed = await query<{ shortcode: string }>(
    `
    INSERT INTO alerts (shortcode, kind)
    SELECT p.shortcode, 'outlier'
    FROM posts p
    WHERE p.outlier_score >= $1
      AND p.is_reel
      -- A six-month-old outlier is not news.
      AND p.posted_at > now() - interval '14 days'
      -- These alerts go to the operator, so only for accounts the operator
      -- cares about: featured ones, or ones an admin tracks. Other users'
      -- accounts must not ping the operator's phone.
      AND EXISTS (
        SELECT 1 FROM competitors c
        WHERE c.id = p.competitor_id
          AND (c.is_curated OR EXISTS (
            SELECT 1 FROM user_competitors uc
            JOIN users u ON u.id = uc.user_id
            WHERE uc.competitor_id = c.id AND u.is_admin
          ))
      )
    ON CONFLICT (shortcode, kind) DO NOTHING
    RETURNING shortcode
    `,
    [config.outlier.threshold]
  );

  if (claimed.length === 0 || opts.silent) {
    return { claimed: claimed.length, notified: 0 };
  }

  const rows = await query<AlertRow>(
    `
    SELECT p.shortcode, c.username, p.url, p.views::text,
           p.outlier_score::text, p.caption
    FROM posts p
    JOIN competitors c ON c.id = p.competitor_id
    WHERE p.shortcode = ANY($1::text[])
    ORDER BY p.outlier_score DESC
    `,
    [claimed.map((r) => r.shortcode)]
  );

  if (rows.length === 0) return { claimed: claimed.length, notified: 0 };

  const listed = rows.slice(0, MAX_LISTED).map((c) => {
    const headline = (c.caption ?? "").replace(/\s+/g, " ").slice(0, 90);
    return [
      `${Number(c.outlier_score ?? 0).toFixed(1)}x @${c.username} - ${compact(
        Number(c.views)
      )} views`,
      headline ? `"${headline}"` : null,
      c.url,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const overflow = rows.length - listed.length;
  const body = [
    `${rows.length} new outlier${rows.length === 1 ? "" : "s"}`,
    "",
    listed.join("\n\n"),
    overflow > 0 ? `\n...and ${overflow} more in the dashboard.` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");

  await Promise.allSettled([sendTelegram(body), sendEmail(body)]);
  return { claimed: claimed.length, notified: rows.length };
}

async function sendTelegram(text: string): Promise<void> {
  const { telegramToken, telegramChatId } = config.alerts;
  if (!telegramToken || !telegramChatId) return;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${telegramToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramChatId,
          // Plain text: captions routinely contain characters that break
          // Markdown parsing and would make Telegram reject the whole message.
          text,
          disable_web_page_preview: false,
        }),
      }
    );
    if (!res.ok) {
      console.error("Telegram alert failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("Telegram alert threw:", err);
  }
}

async function sendEmail(text: string): Promise<void> {
  const { resendKey, emailTo, emailFrom } = config.alerts;
  if (!resendKey || !emailTo) return;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [emailTo],
        subject: "Reel Radar: new competitor outliers",
        text,
      }),
    });
    if (!res.ok) {
      console.error("Email alert failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("Email alert threw:", err);
  }
}
