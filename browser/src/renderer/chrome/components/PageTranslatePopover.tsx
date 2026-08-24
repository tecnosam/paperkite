import { useEffect, useRef, useState } from 'react';
import type { AgentConfig, PageTranslateSettings, PageTranslateStatusPayload } from '../../../shared/types';
import { TRANSLATE_LANGUAGES } from '../../../shared/types';
import { TranslateIcon, CloseIcon } from '../icons';

interface PageTranslatePopoverProps {
  settings: PageTranslateSettings;
  status: PageTranslateStatusPayload;
  onClose: () => void;
  onChange: (settings: PageTranslateSettings) => void;
}

/** Toolbar popover for in-page text translation - same shell as
 * SubtitlePopover (shares its `.toolbar-popover` CSS), anchored under its
 * own toolbar button.
 *
 * The main control is a real button, not a toggle switch - deliberately,
 * so its label/spinner can directly reflect what's actually happening
 * (about to start, mid-translation, done, failed) rather than a bare
 * on/off state that gives no sign of life while a page's worth of text is
 * being walked and sent through an agent. See `status` (main/ipc.ts pushes
 * this - PageTranslateStatus's doc comment covers the state machine).
 *
 * Unlike live subtitles, there's no whisper-equivalent built-in engine
 * here - translating arbitrary page text always needs an agent, so the
 * button stays disabled until one's picked (see canEnable below), rather
 * than defaulting to some fallback the way subtitles' WHISPER_ENGINE does. */
export function PageTranslatePopover({ settings, status, onClose, onChange }: PageTranslatePopoverProps) {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = window.paperkite.onAgentsUpdated(setAgents);
    window.paperkite.requestAgents();
    return unsub;
  }, []);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [onClose]);

  const canEnable = !!settings.agentId && agents.some((a) => a.id === settings.agentId);
  // 'idle' while enabled is the brief gap between sending ENABLE and the
  // tab's preload reporting back its first walk - treated as still
  // "working" rather than "done", so the button never flashes a wrong
  // "Show original" for text that hasn't actually been translated yet.
  const isWorking = settings.enabled && (status.status === 'idle' || status.status === 'translating');
  const isDone = settings.enabled && status.status === 'done';
  const isError = settings.enabled && status.status === 'error';

  const mainAction = () => {
    if (!settings.enabled) {
      if (canEnable) onChange({ ...settings, enabled: true });
      return;
    }
    if (isError) {
      onChange({ ...settings }); // same settings, re-sent - forces a fresh ENABLE (see TabManager.setActivePageTranslateSettings)
      return;
    }
    onChange({ ...settings, enabled: false }); // isDone (or isWorking, treated as cancel) - reverts either way
  };

  let buttonLabel = 'Translate page';
  if (isWorking) buttonLabel = 'Translating…';
  else if (isDone) buttonLabel = 'Show original';
  else if (isError) buttonLabel = 'Try again';

  return (
    <div className="toolbar-popover" ref={popoverRef}>
      <div className="toolbar-popover__header">
        <TranslateIcon size={14} />
        <span>Translate page</span>
        <button type="button" className="toolbar-popover__close" aria-label="Close" onClick={onClose}>
          <CloseIcon size={11} />
        </button>
      </div>

      <label className="toolbar-popover__field">
        <span>Agent</span>
        <select
          value={settings.agentId ?? ''}
          disabled={isWorking}
          onChange={(e) => onChange({ ...settings, agentId: e.target.value || null })}
        >
          <option value="">Choose an agent…</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </label>

      <label className="toolbar-popover__field">
        <span>Language</span>
        <select
          value={settings.language}
          disabled={isWorking}
          onChange={(e) => onChange({ ...settings, language: e.target.value })}
        >
          {TRANSLATE_LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className={'page-translate-popover__action' + (isDone ? ' page-translate-popover__action--done' : '')}
        disabled={(!settings.enabled && !canEnable) || isWorking}
        onClick={mainAction}
      >
        {isWorking && <span className="spinner" />}
        {buttonLabel}
      </button>

      {isError && status.error && <p className="settings-hint page-translate-popover__error">{status.error}</p>}
      {agents.length === 0 && <p className="settings-hint">Add an agent in Settings first - see Agents.</p>}
      {agents.length > 0 && !settings.agentId && (
        <p className="settings-hint">Pick an agent above to translate this page&rsquo;s text.</p>
      )}
    </div>
  );
}
