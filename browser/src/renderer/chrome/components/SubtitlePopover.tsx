import { useEffect, useRef, useState } from 'react';
import type { AgentConfig, SubtitleSettings } from '../../../shared/types';
import { TRANSLATE_LANGUAGES, WHISPER_ENGINE, WHISPER_TRANSLATE_ENGINE } from '../../../shared/types';
import { SubtitlesIcon, CloseIcon } from '../icons';

interface SubtitlePopoverProps {
  settings: SubtitleSettings;
  onClose: () => void;
  onChange: (settings: SubtitleSettings) => void;
}

/** Toolbar popover for the live-translation subtitle overlay - same shell
 * pattern as BookmarkPopover, anchored under its own toolbar button.
 * Changes apply immediately (no separate save step), matching every other
 * toggle/select in this app.
 *
 * Engine is explicitly chosen here, never auto-selected (see
 * shared/types.ts's SubtitleSettings doc comment for what each of the
 * three does) - the toggle itself can always turn on, since
 * WHISPER_ENGINE (the default) needs nothing beyond whisper.cpp being
 * configured at all. */
export function SubtitlePopover({ settings, onClose, onChange }: SubtitlePopoverProps) {
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

  const isWhisperOnlyEngine = settings.engine === WHISPER_ENGINE || settings.engine === WHISPER_TRANSLATE_ENGINE;

  return (
    <div className="toolbar-popover" ref={popoverRef}>
      <div className="toolbar-popover__header">
        <SubtitlesIcon size={14} />
        <span>Live subtitles</span>
        <button type="button" className="toolbar-popover__close" aria-label="Close" onClick={onClose}>
          <CloseIcon size={11} />
        </button>
      </div>

      <div className="toolbar-popover__toggle-row">
        <span>Translate this video</span>
        <button
          type="button"
          className={'switch' + (settings.enabled ? ' switch--on' : '')}
          role="switch"
          aria-checked={settings.enabled}
          onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
        >
          <span className="switch__thumb" />
        </button>
      </div>

      <label className="toolbar-popover__field">
        <span>Engine</span>
        <select value={settings.engine} onChange={(e) => onChange({ ...settings, engine: e.target.value })}>
          <option value={WHISPER_ENGINE}>Whisper</option>
          <option value={WHISPER_TRANSLATE_ENGINE}>Whisper (translate)</option>
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
          disabled={isWhisperOnlyEngine}
          onChange={(e) => onChange({ ...settings, language: e.target.value })}
        >
          {TRANSLATE_LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </select>
      </label>

      {settings.engine === WHISPER_ENGINE && (
        <p className="settings-hint">Captions show in whatever language is spoken - no translation.</p>
      )}
      {settings.engine === WHISPER_TRANSLATE_ENGINE && (
        <p className="settings-hint">Whisper&rsquo;s own translation always outputs English, regardless of the language above.</p>
      )}
      {agents.length === 0 && (
        <p className="settings-hint">Add an agent in Settings to translate into other languages - see Agents.</p>
      )}
    </div>
  );
}
