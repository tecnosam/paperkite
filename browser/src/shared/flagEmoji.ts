/**
 * Converts an ISO 3166-1 alpha-2 country code ("US", "jp") into its flag
 * emoji by offsetting each letter into the Unicode "regional indicator
 * symbol" block. No image assets, no network - works fully offline.
 */
export function flagEmoji(countryCode: string): string {
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '🏳️';

  const codePoints = [...code].map((char) => 0x1f1e6 + (char.charCodeAt(0) - 65));
  return String.fromCodePoint(...codePoints);
}
