interface WhisperRequiredModalProps {
  onOpenSettings: () => void;
  onDismiss: () => void;
}

/** Shown instead of actually turning live translate on when whisper.cpp
 * isn't set up - Paperkite doesn't install or bundle it (see
 * main/whisperStore.ts), so this is the "you need to go get this
 * yourself" moment rather than a silent failure or a fake placeholder. */
export function WhisperRequiredModal({ onOpenSettings, onDismiss }: WhisperRequiredModalProps) {
  return (
    <div className="modal-overlay" onClick={onDismiss}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <span className="modal__kite" aria-hidden>
          🎙️
        </span>
        <h1>Live translate needs whisper.cpp</h1>
        <p>
          Paperkite doesn't bundle it - install it however you like (Homebrew, building from source, etc.), then
          point Paperkite at the binary and a model file in Settings.
        </p>
        <div className="modal__actions">
          <button type="button" className="modal__actions-secondary" onClick={onDismiss}>
            Not now
          </button>
          <button type="button" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      </div>
    </div>
  );
}
