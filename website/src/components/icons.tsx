/** Inline stroke icons, matching the browser app's icon language:
 *  16x16 viewBox, 1.6 stroke, round caps/joins. */
type IconProps = { size?: number; className?: string };

const base = {
  viewBox: '0 0 16 16',
  stroke: 'currentColor',
  fill: 'none' as const,
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function KiteMark({ size = 28, className }: IconProps) {
  return (
    <svg width={size} height={(size * 38) / 32} viewBox="0 0 32 38" className={className} aria-hidden>
      <path d="M16 3 27 15 16 29 5 15Z" fill="var(--accent)" stroke="none" />
      <path d="M16 3 27 15 16 29 5 15Z" stroke="var(--ink)" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
      <path d="M16 3V29" stroke="var(--accent-ink)" strokeWidth="1.1" opacity="0.55" />
      <path d="M5 15h22" stroke="var(--accent-ink)" strokeWidth="1.1" opacity="0.55" />
      <path d="M16 29c1.5 2 1 4.2-1.4 5.6" stroke="var(--sky)" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function ChatBubbleIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" strokeLinejoin="round" />
    </svg>
  );
}

export function ServerIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <rect x="2.5" y="2.5" width="11" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="11" height="4.5" rx="1" />
      <circle cx="5" cy="4.75" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="5" cy="11.25" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SparkleIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base} strokeWidth={1.4}>
      <path d="M8 2.2c.4 2.3 1 3.1 3.5 3.5-2.5.4-3.1 1.2-3.5 3.5-.4-2.3-1-3.1-3.5-3.5C7 5.3 7.6 4.5 8 2.2z" strokeLinejoin="round" />
      <path d="M12.7 9.8c.24 1.28.6 1.66 1.8 1.9-1.2.24-1.56.62-1.8 1.9-.24-1.28-.6-1.66-1.8-1.9 1.2-.24 1.56-.62 1.8-1.9z" strokeLinejoin="round" />
    </svg>
  );
}

export function PlugIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0z" />
      <path d="M8 11v3" />
    </svg>
  );
}

export function BroadcastIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
      <path d="M5.2 5.2a4 4 0 0 0 0 5.6M10.8 5.2a4 4 0 0 1 0 5.6" />
      <path d="M2.8 2.8a8 8 0 0 0 0 10.4M13.2 2.8a8 8 0 0 1 0 10.4" />
    </svg>
  );
}

export function MicIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <rect x="6" y="2" width="4" height="7" rx="2" />
      <path d="M4 8a4 4 0 0 0 8 0M8 12v2" />
    </svg>
  );
}

export function GlobeIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c1.8 1.6 2.8 3.6 2.8 5.5S9.8 12.4 8 14M8 2.5C6.2 4.1 5.2 6.1 5.2 8s1 3.9 2.8 5.5" />
    </svg>
  );
}

export function LockOpenIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <rect x="3.5" y="7.5" width="9" height="6" rx="1.3" />
      <path d="M5.5 7.5V5.2A2.5 2.5 0 0 1 10.3 4.3" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base} strokeWidth={1.8}>
      <path d="M2.5 8h11M9 4l4 4-4 4" />
    </svg>
  );
}

export function ArrowUpRightIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base} strokeWidth={1.7}>
      <path d="M4.5 11.5l7-7M6 4h5.5v5.5" />
    </svg>
  );
}

export function GithubIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 .3a8 8 0 0 0-2.53 15.6c.4.07.55-.17.55-.38v-1.5c-2.23.48-2.7-1.07-2.7-1.07-.36-.94-.89-1.19-.89-1.19-.72-.5.06-.49.06-.49.8.06 1.22.83 1.22.83.71 1.23 1.87.87 2.33.67.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.97 0-.88.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.13 0 0 .67-.22 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.11.16 1.93.08 2.13.52.56.83 1.27.83 2.15 0 3.09-1.87 3.77-3.66 3.97.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 .3z" />
    </svg>
  );
}

export function DotIcon({ size = 8, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" className={className} aria-hidden>
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  );
}

export function PulseIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M1.5 8h3l1.5-4 2.5 8 1.5-4h4" />
    </svg>
  );
}

export function CheckIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base} strokeWidth={1.9}>
      <path d="M3 8.3 6.2 11.5 13 4.5" />
    </svg>
  );
}

export function MoonIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <path d="M13 9.1A5.4 5.4 0 0 1 6.9 3 5.4 5.4 0 1 0 13 9.1z" strokeLinejoin="round" />
    </svg>
  );
}

export function SunIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} {...base}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.4 3.6l-1.3 1.3M4.9 11.1l-1.3 1.3M12.4 12.4l-1.3-1.3M4.9 4.9 3.6 3.6" />
    </svg>
  );
}
