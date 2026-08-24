interface NoAudioDetectedModalProps {
  onOpenSettings: () => void;
  onDismiss: () => void;
}

/** Shown once audioCapture.ts's RMS check catches several consecutive
 * chunks of real digital silence - live translate has already been turned
 * back off by the time this appears (see App.tsx), so this is purely
 * explaining what happened and what to check, not blocking anything.
 * Deliberately doesn't point at a specific cause (an earlier version of
 * this modal assumed it was always the macOS Screen & System Audio
 * Recording permission - that theory didn't survive contact with a real
 * fix: the actual bug turned out to be main/index.ts requesting the wrong
 * capture mode entirely, permission never being the issue). Silence can
 * still genuinely mean the permission's missing, or whisper.cpp/model
 * misconfigured, or the tab just isn't playing anything right now - so the
 * copy stays honest about not knowing which, and points at Settings rather
 * than asserting a diagnosis. */
export function NoAudioDetectedModal({ onOpenSettings, onDismiss }: NoAudioDetectedModalProps) {
  return (
    <div className="modal-overlay" onClick={onDismiss}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <span className="modal__kite" aria-hidden>
          🔈
        </span>
        <h1>No audio detected</h1>
        <p>
          Live translate didn&rsquo;t pick up any real sound from this tab, so it&rsquo;s been turned back off. A
          couple of things worth checking: that something&rsquo;s actually playing here (not a different tab), and
          that whisper.cpp is set up correctly in Settings.
        </p>
        <div className="modal__actions">
          <button type="button" className="modal__actions-secondary" onClick={onDismiss}>
            Got it
          </button>
          <button type="button" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      </div>
    </div>
  );
}
