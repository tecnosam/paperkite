import { useEffect, useState } from 'react';
import type { WhisperStatus } from '../../../../shared/types';

/** Settings > Live Translate - locating whisper.cpp (see
 * main/whisperStore.ts). Paperkite doesn't install, bundle, or manage
 * whisper.cpp itself: the binary is either found on PATH under a name we
 * recognize, or pointed at explicitly here; the model file is always an
 * explicit pick, since there's no download flow. Self-contained, like
 * McpSection/AgentsSection - owns its own IPC subscription rather than
 * getting whisper status as a prop from SettingsModal. */
export function LiveTranslateSection() {
  const [status, setStatus] = useState<WhisperStatus | null>(null);
  const [binaryDraft, setBinaryDraft] = useState('');

  useEffect(() => {
    const unsub = window.paperkite.onWhisperStatus((s) => {
      setStatus(s);
      setBinaryDraft(s.binaryPathOverride ?? '');
    });
    window.paperkite.requestWhisperStatus();
    return unsub;
  }, []);

  const binaryChanged = status !== null && binaryDraft !== (status.binaryPathOverride ?? '');

  const saveBinaryPath = () => {
    const trimmed = binaryDraft.trim();
    window.paperkite.setWhisperConfig({
      binaryPath: trimmed || null,
      modelPath: status?.modelPath ?? null,
      translateModelPath: status?.translateModelPath ?? null,
    });
  };

  return (
    <section className="settings-section">
      <h2>Live Translate</h2>
      <p className="settings-hint">
        Live translate transcribes tab audio with a local whisper.cpp install, then translates the result with
        whichever agent you pick in the subtitles popover. Paperkite doesn't install or bundle whisper.cpp - get it
        onto your machine however you like, then point at it below.
      </p>

      {status && (
        <p className={'mcp-test-result' + (status.ready ? '' : ' mcp-test-result--error')}>
          {status.ready
            ? 'Ready - live translate can run.'
            : !status.effectiveBinaryPath
              ? "Can't find a whisper.cpp binary - set a path below."
              : "No model file selected yet."}
        </p>
      )}

      <label className="proxy-form__field proxy-form__field--full">
        <span>whisper.cpp binary</span>
        <input
          value={binaryDraft}
          spellCheck={false}
          placeholder="Auto-detecting from PATH…"
          onChange={(e) => setBinaryDraft(e.target.value)}
        />
      </label>
      {status?.effectiveBinaryPath && !binaryChanged && (
        <p className="settings-hint">
          {status.binaryAutoDetected ? 'Auto-detected: ' : 'Using: '}
          <code>{status.effectiveBinaryPath}</code>
        </p>
      )}
      {binaryChanged && (
        <button type="button" className="proxy-form__save" onClick={saveBinaryPath}>
          Save
        </button>
      )}

      <label className="proxy-form__field proxy-form__field--full" style={{ marginTop: 14 }}>
        <span>Model file (.bin)</span>
        <div className="bookmark-popover__new-folder">
          <input value={status?.modelPath ?? ''} spellCheck={false} placeholder="No model selected" readOnly />
          <button type="button" onClick={() => window.paperkite.pickWhisperModel()}>
            Choose…
          </button>
        </div>
      </label>
      {status?.modelPath && !status.modelExists && (
        <p className="mcp-test-result mcp-test-result--error">That file no longer exists at this path.</p>
      )}

      <label className="proxy-form__field proxy-form__field--full" style={{ marginTop: 14 }}>
        <span>Translate model (optional)</span>
        <div className="bookmark-popover__new-folder">
          <input value={status?.translateModelPath ?? ''} spellCheck={false} placeholder="Same as model above" readOnly />
          <button type="button" onClick={() => window.paperkite.pickWhisperTranslateModel()}>
            Choose…
          </button>
        </div>
      </label>
      <p className="settings-hint">
        Only used for whisper-only translation (no agent selected, target language English) - see the subtitles
        popover. Not every model supports whisper&rsquo;s own translate task: <code>large-v3-turbo</code> in
        particular silently just transcribes in the original language instead of translating it. If you're on
        turbo and want whisper-only translation, set this to a model that does support it (e.g. large-v3, medium,
        small, base). Leave unset if your model above already works, or if you always translate through an agent.
      </p>
      {status?.translateModelPath && !status.translateModelExists && (
        <p className="mcp-test-result mcp-test-result--error">That file no longer exists at this path.</p>
      )}
    </section>
  );
}
