import { useState } from 'react';
import type { ProxySettings } from '../../../../shared/types';

interface NetworkSectionProps {
  proxySettings: ProxySettings;
  onSaveProxySettings: (settings: ProxySettings) => void;
}

const MODE_OPTIONS: Array<{ value: ProxySettings['mode']; label: string }> = [
  { value: 'direct', label: 'Off' },
  { value: 'manual', label: 'Manual' },
];

const PROTOCOL_OPTIONS: Array<ProxySettings['protocol']> = ['http', 'https', 'socks5'];

export function NetworkSection({ proxySettings, onSaveProxySettings }: NetworkSectionProps) {
  const [draft, setDraft] = useState<ProxySettings>(proxySettings);

  const changed =
    draft.mode !== proxySettings.mode ||
    draft.protocol !== proxySettings.protocol ||
    draft.host !== proxySettings.host ||
    draft.port !== proxySettings.port ||
    draft.bypassList !== proxySettings.bypassList;
  const canSave = changed && (draft.mode === 'direct' || (draft.host.trim().length > 0 && draft.port.trim().length > 0));

  return (
    <section className="settings-section">
      <h2>Proxy</h2>

      <div className="segmented" role="radiogroup" aria-label="Proxy mode">
        {MODE_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={draft.mode === value}
            className={'segmented__option' + (draft.mode === value ? ' segmented__option--active' : '')}
            onClick={() => setDraft({ ...draft, mode: value })}
          >
            {label}
          </button>
        ))}
      </div>

      <form
        className="proxy-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) onSaveProxySettings(draft);
        }}
      >
        {draft.mode === 'manual' && (
          <>
            <label className="proxy-form__field">
              <span>Protocol</span>
              <select
                value={draft.protocol}
                onChange={(e) => setDraft({ ...draft, protocol: e.target.value as ProxySettings['protocol'] })}
              >
                {PROTOCOL_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>

            <label className="proxy-form__field">
              <span>Host</span>
              <input
                value={draft.host}
                spellCheck={false}
                placeholder="127.0.0.1"
                onChange={(e) => setDraft({ ...draft, host: e.target.value })}
              />
            </label>

            <label className="proxy-form__field proxy-form__field--narrow">
              <span>Port</span>
              <input
                value={draft.port}
                spellCheck={false}
                placeholder="8080"
                onChange={(e) => setDraft({ ...draft, port: e.target.value })}
              />
            </label>

            <label className="proxy-form__field">
              <span>Bypass list</span>
              <input
                value={draft.bypassList}
                spellCheck={false}
                placeholder="localhost,127.0.0.1"
                onChange={(e) => setDraft({ ...draft, bypassList: e.target.value })}
              />
            </label>
          </>
        )}

        {changed && (
          <button type="submit" className="proxy-form__save" disabled={!canSave}>
            Save
          </button>
        )}
      </form>

      <p className="settings-hint">Applies to all browsing tabs immediately after saving.</p>
    </section>
  );
}
