/**
 * Mock word-based content filters for the safety-settings toggles. These
 * are deliberately small, mild placeholder lists to demonstrate the
 * masking mechanism for this UI-validation milestone - not a real
 * moderation system. Swap for a real service later; call sites only
 * care about maskProfanity()/maskFlaggedContent() taking text in and
 * text out.
 */

const PROFANITY_WORDS = ['damn', 'hell', 'crap', 'darn'];
const FLAGGED_CONTENT_WORDS = ['nsfw', 'xxx', 'explicit'];

function maskWords(text: string, words: string[]): string {
  if (words.length === 0) return text;
  const pattern = new RegExp(`\\b(${words.join('|')})\\b`, 'gi');
  return text.replace(pattern, (match) => match[0] + '*'.repeat(match.length - 1));
}

export function maskProfanity(text: string): string {
  return maskWords(text, PROFANITY_WORDS);
}

export function maskFlaggedContent(text: string): string {
  return maskWords(text, FLAGGED_CONTENT_WORDS);
}
