interface AudioCaptureErrorModalProps {
  onDismiss: () => void;
}

/** Shown when getDisplayMedia itself fails - overwhelmingly the likely
 * cause the first time anyone tries this on macOS is that the app isn't
 * listed under Screen & System Audio Recording yet (confirmed by hand:
 * Chromium hands back a *silent* audio track instead of throwing when this
 * permission is missing, so this can't be detected any earlier than "the
 * whole capture attempt failed"). Named for what it's actually about
 * rather than generically, since there's a specific, known fix to point at. */
export function AudioCaptureErrorModal({ onDismiss }: AudioCaptureErrorModalProps) {
  return (
    <div className="modal-overlay" onClick={onDismiss}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <span className="modal__kite" aria-hidden>
          🔇
        </span>
        <h1>Couldn't capture audio</h1>
        <p>
          Paperkite likely needs permission. Open System Settings → Privacy &amp; Security → Screen &amp; System Audio
          Recording, and turn it on for this app - then try again.
        </p>
        <button type="button" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}
