import type { SafetySettings } from '../../../../shared/types';

interface SafetySectionProps {
  safety: SafetySettings;
  onSaveSafety: (settings: SafetySettings) => void;
}

const SAFETY_TOGGLES: Array<{ key: keyof SafetySettings; label: string; description: string }> = [
  {
    key: 'censorProfanity',
    label: 'Censor profanity',
    description: 'Mask common swear words in messages.',
  },
  {
    key: 'censorNudity',
    label: 'Censor nudity',
    description: 'Mask flagged adult-content links and terms.',
  },
  {
    key: 'censorHyperlinks',
    label: 'Filter hyperlinks',
    description:
      'Only links from trusted or same-site sources are clickable; suspicious links are hidden. Turn off to make every link clickable, unfiltered.',
  },
];

export function SafetySection({ safety, onSaveSafety }: SafetySectionProps) {
  return (
    <section className="settings-section">
      <h2>Safety</h2>
      <div className="settings-toggles">
        {SAFETY_TOGGLES.map(({ key, label, description }) => (
          <label key={key} className="settings-toggle">
            <span className="settings-toggle__text">
              <span className="settings-toggle__label">{label}</span>
              <span className="settings-toggle__desc">{description}</span>
            </span>
            <span
              className={'switch' + (safety[key] ? ' switch--on' : '')}
              role="switch"
              aria-checked={safety[key]}
              tabIndex={0}
              onClick={() => onSaveSafety({ ...safety, [key]: !safety[key] })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSaveSafety({ ...safety, [key]: !safety[key] });
                }
              }}
            >
              <span className="switch__thumb" />
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
