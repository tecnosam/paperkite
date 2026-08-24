import { useEffect } from 'react';

interface UsernameTakenModalProps {
  serverName: string;
  username: string;
  onOpenSettings: () => void;
  onDismiss: () => void;
}

/**
 * Shown in place of the old bare inline error text when a chat server
 * rejects /connect because the configured username is already claimed
 * there (see shared/types.ts's ChatConnectionStatus.reason) - that's a
 * permanent failure the user can only fix by picking a different name, not
 * something worth a small line of text easy to miss under the message
 * list. Only renders full-screen because main grows the chat WebContentsView
 * to cover the whole window while it's open, the same trick ImageLightbox
 * uses - see WindowManager.setChatFullscreen, triggered by the
 * setOverlayOpen call in chat/App.tsx.
 */
export function UsernameTakenModal({ serverName, username, onOpenSettings, onDismiss }: UsernameTakenModalProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  return (
    <div className="username-taken" onClick={onDismiss}>
      <div className="username-taken__card" onClick={(e) => e.stopPropagation()}>
        <span className="username-taken__glyph" aria-hidden>
          <svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="6.2" cy="8" r="4.2" />
            <circle cx="9.8" cy="8" r="4.2" />
          </svg>
        </span>
        <h1>That name's taken</h1>
        <p>
          <strong>&ldquo;{username}&rdquo;</strong> is already claimed on <strong>{serverName}</strong>. Usernames are
          per-server and, once used, held permanently — pick a different one to chat here.
        </p>
        <div className="username-taken__actions">
          <button type="button" className="username-taken__primary" onClick={onOpenSettings}>
            Choose a different username
          </button>
          <button type="button" className="username-taken__dismiss" onClick={onDismiss}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
