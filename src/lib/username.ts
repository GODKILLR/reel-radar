/** Accepts a bare handle, an @handle, or a full profile URL. */
export function parseUsername(input: string): string | null {
  let value = input.trim();
  if (!value) return null;

  const urlMatch = value.match(/instagram\.com\/(?:_u\/)?([A-Za-z0-9._]+)/i);
  if (urlMatch) value = urlMatch[1];

  value = value.replace(/^@/, "").replace(/\/+$/, "").toLowerCase();

  // Instagram handles: letters, digits, periods, underscores, max 30 chars.
  if (!/^[a-z0-9._]{1,30}$/.test(value)) return null;

  // Reject path segments that are Instagram routes rather than profiles.
  const reserved = new Set(["p", "reel", "reels", "explore", "stories", "tv"]);
  if (reserved.has(value)) return null;

  return value;
}
