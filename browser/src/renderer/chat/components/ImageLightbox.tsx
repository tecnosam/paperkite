import { useEffect, useRef, useState } from 'react';
import type { MessageAttachment, ScreenshotChainNode } from '../../../shared/types';
import { CloseIcon, DownloadIcon } from '../icons';
import { ScreenshotChain } from './ScreenshotChain';

interface ImageLightboxProps {
  attachment: MessageAttachment;
  onClose: () => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
/** What's actually on screen right now - starts as the attachment that
 * was clicked, but the chain strip lets the user navigate to a neighbor
 * without closing/reopening the lightbox. */
interface Displayed {
  id: string;
  dataUrl: string;
  url: string;
}

/** Strips the scheme for display, matching the address bar's convention.
 * Defensive against a missing url - see the ref-based staleness guard
 * below for why this should never actually happen, but a rendering crash
 * from one bad value taking down the whole lightbox is worse than a
 * blank source line. */
function displayUrl(url: string | undefined): string {
  return (url ?? '').replace(/^https?:\/\//, '');
}

/**
 * Full-screen image viewer for a chat screenshot. The chat panel is
 * normally just a CHAT_WIDTH-wide sidebar - this only actually renders
 * full-screen because main grows the chat WebContentsView to cover the
 * whole window while it's open (see WindowManager.setChatFullscreen,
 * triggered by the setOverlayOpen call in chat/App.tsx).
 */
export function ImageLightbox({ attachment, onClose }: ImageLightboxProps) {
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [displayed, setDisplayed] = useState<Displayed>(attachment);
  const [chainNodes, setChainNodes] = useState<ScreenshotChainNode[] | null>(null);

  // Chain ids aren't unique to one "center" - adjacent windows overlap
  // (whoever's chain includes B also appears in B's own chain), so a
  // response is only ever trustworthy against "what did we most recently
  // ask for", tracked in a ref that's always current. A ref (not state)
  // is what lets a single, never-torn-down IPC subscription below check
  // freshness without needing to be re-created on every navigation - the
  // previous version resubscribed on every click, which is exactly the
  // kind of subscribe/unsubscribe churn that can leave a request's
  // response validated against a stale closure mid-transition.
  const latestRequestedId = useRef(displayed.id);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(
    () =>
      window.paperkiteChat.onImageSaved((result) => {
        setSaveState(result.ok ? 'saved' : 'error');
      }),
    [],
  );

  // Single stable subscription for the whole lifetime of the lightbox -
  // never re-subscribed, so there's never a window with zero or two
  // listeners registered.
  useEffect(
    () =>
      window.paperkiteChat.onScreenshotChain((result) => {
        if (result.targetId === latestRequestedId.current) setChainNodes(result.nodes);
      }),
    [],
  );

  // Deliberately does NOT clear chainNodes first - the old (still mostly
  // accurate) chain stays visible until the new one arrives, rather than
  // the strip blanking out on every click.
  useEffect(() => {
    latestRequestedId.current = displayed.id;
    window.paperkiteChat.requestScreenshotChain(displayed.id);
  }, [displayed.id]);

  const save = () => {
    if (saveState === 'saving') return;
    setSaveState('saving');
    window.paperkiteChat.saveImage(displayed.dataUrl);
  };

  const saveLabel = { idle: 'Save to Downloads', saving: 'Saving…', saved: 'Saved', error: 'Failed - try again' }[saveState];

  return (
    <div className="lightbox" onClick={onClose}>
      <button type="button" className="lightbox__close" aria-label="Close" onClick={onClose}>
        <CloseIcon size={14} />
      </button>

      <div className="lightbox__content" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="lightbox__source"
          title={displayed.url}
          onClick={() => window.paperkiteChat.openLink(displayed.url)}
        >
          {displayUrl(displayed.url)}
        </button>

        <img className="lightbox__image" src={displayed.dataUrl} alt="Screenshot" />

        <button
          type="button"
          className={'lightbox__save' + (saveState === 'saved' ? ' lightbox__save--done' : '')}
          onClick={save}
        >
          <DownloadIcon size={13} />
          {saveLabel}
        </button>

        {chainNodes && (
          <ScreenshotChain
            nodes={chainNodes}
            currentId={displayed.id}
            onSelect={(node) => {
              setSaveState('idle');
              setDisplayed({ id: node.id, dataUrl: node.dataUrl, url: node.url });
            }}
          />
        )}
      </div>
    </div>
  );
}
