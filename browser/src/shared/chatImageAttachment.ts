/**
 * Encodes a page-chat screenshot into the message's own plain `content`
 * string, flagged with a prefix so it can be told apart from a normal text
 * message on decode. This is deliberate: the chat-service /send endpoint
 * only ever carries a single opaque `content` string (see
 * ../../chat-service/PROTOCOL.md) and needs no changes for this - it just
 * stores/relays whatever string it's given, never inspecting it. Composing
 * (main/chatClient.ts is never involved) and rendering both happen
 * entirely in the chat renderer - see MessageInput.tsx (encode) and
 * MessageList.tsx (decode).
 */

const FLAG_PREFIX = 'pk-img-v1:';

export interface ChatImagePayload {
  /** Full data: URL (e.g. "data:image/jpeg;base64,...") - already what
   * main/screenshot.ts's captureCompressedScreenshot produces. */
  dataUrl: string;
  /** Caption typed alongside the screenshot - may be empty. */
  text: string;
}

export function encodeChatImageMessage(payload: ChatImagePayload): string {
  return FLAG_PREFIX + JSON.stringify(payload);
}

/** `null` for anything that isn't a flagged image message - an ordinary
 * text message, or (defensively) a flagged-looking string that doesn't
 * actually parse as one. */
export function decodeChatImageMessage(content: string): ChatImagePayload | null {
  if (!content.startsWith(FLAG_PREFIX)) return null;
  try {
    const parsed = JSON.parse(content.slice(FLAG_PREFIX.length)) as Partial<ChatImagePayload>;
    if (typeof parsed.dataUrl !== 'string') return null;
    return { dataUrl: parsed.dataUrl, text: typeof parsed.text === 'string' ? parsed.text : '' };
  } catch {
    return null;
  }
}
