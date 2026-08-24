/**
 * Turns a native page capture into a compact, self-contained chat
 * attachment. Kept separate from TabManager (which only owns the raw
 * capturePage() call) since compression is a distinct concern - resizing
 * and re-encoding is what keeps a screenshot message from bloating
 * chatHistory.json the way an uncompressed capture would.
 */
import { randomUUID } from 'node:crypto';
import type { TabManager } from './tabManager';
import type { MessageAttachment } from '../shared/types';

/** Wide enough that the lightbox (up to 92vw) still looks sharp, not just
 * the ~160px chat-bubble thumbnail - a browser downscales a too-large
 * source image for the bubble just fine, but can't upscale a too-small
 * one for the lightbox without going soft. */
const MAX_WIDTH = 960;
const JPEG_QUALITY = 72;

/** Captures the active tab's current viewport and returns a compressed,
 * base64-encoded JPEG ready to attach to a chat message - `null` if
 * there's no active tab or the capture fails for any reason. */
export async function captureCompressedScreenshot(tabs: TabManager): Promise<MessageAttachment | null> {
  try {
    const capture = tabs.captureActivePage();
    if (!capture) return null;
    const url = tabs.getActiveView()?.webContents.getURL();
    if (!url) return null;
    const image = await capture;

    const { width } = image.getSize();
    const resized = width > MAX_WIDTH ? image.resize({ width: MAX_WIDTH }) : image;
    const finalSize = resized.getSize();

    const jpeg = resized.toJPEG(JPEG_QUALITY);
    return {
      kind: 'screenshot',
      id: randomUUID(),
      dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      width: finalSize.width,
      height: finalSize.height,
      url,
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}
