import type { ThemeSource } from '../../../../shared/types';

interface GeneralSectionProps {
  themeSource: ThemeSource;
  onSaveTheme: (source: ThemeSource) => void;
}

const THEME_OPTIONS: Array<{ value: ThemeSource; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function GeneralSection({ themeSource, onSaveTheme }: GeneralSectionProps) {
  return (
    <section className="settings-section">
      <h2>Appearance</h2>
      <div className="segmented" role="radiogroup" aria-label="Theme">
        {THEME_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={themeSource === value}
            className={'segmented__option' + (themeSource === value ? ' segmented__option--active' : '')}
            onClick={() => onSaveTheme(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
