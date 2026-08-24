/**
 * Small inline stroke icons, drawn to match the paper/ink aesthetic
 * instead of pulling in an icon font or library for a handful of glyphs.
 */
type IconProps = { size?: number };

const base = {
  fill: 'none',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function BackIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <path d="M10 3 5 8l5 5" />
    </svg>
  );
}

export function ForwardIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

export function ReloadIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <path d="M13 8A5 5 0 1 1 11.5 4.3" />
      <path d="M13 2.5V5.5H10" />
    </svg>
  );
}

export function StopIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function CheckIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export function PlusIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function CloseIcon({ size = 11 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function ChatIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" strokeLinejoin="round" />
    </svg>
  );
}

export function GlobeIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c1.8 1.6 1.8 9.4 0 11M8 2.5c-1.8 1.6-1.8 9.4 0 11" />
    </svg>
  );
}

export function GearIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <circle cx="8" cy="8" r="2.3" />
      <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.24 3.76l-1.13 1.13M4.89 11.11l-1.13 1.13M12.24 12.24l-1.13-1.13M4.89 4.89 3.76 3.76" />
    </svg>
  );
}

export function StarIcon({ size = 14, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base} fill={filled ? 'currentColor' : 'none'}>
      <path d="M8 1.8l1.9 3.85 4.25.62-3.08 3 .73 4.23L8 11.5l-3.8 2 .73-4.23-3.08-3 4.25-.62L8 1.8z" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <circle cx="7" cy="7" r="4.6" />
      <path d="M14 14l-3.2-3.2" />
    </svg>
  );
}

export function TrashIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <path d="M3 4.5h10M6.2 4.5V3a.8.8 0 0 1 .8-.8h2a.8.8 0 0 1 .8.8v1.5M4.5 4.5l.6 8.4a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.4" />
    </svg>
  );
}

export function ChevronUpIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <path d="M4 10l4-4 4 4" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export function DownloadIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 12.5h10" />
    </svg>
  );
}

export function EditIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <path d="M10.5 2.5 13.5 5.5 5 14H2v-3z" strokeLinejoin="round" />
    </svg>
  );
}

export function FolderIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <path d="M2 4.2a.8.8 0 0 1 .8-.8h3.4l1.4 1.6h5.6a.8.8 0 0 1 .8.8v6.2a.8.8 0 0 1-.8.8H2.8a.8.8 0 0 1-.8-.8z" strokeLinejoin="round" />
    </svg>
  );
}

export function SubtitlesIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.8" />
      <path d="M4 8.5h3M4 10.5h5M9.5 8.5h2.5" />
    </svg>
  );
}

export function TranslateIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <path d="M2 5.2h8.2M7.2 2.4l3 2.8-3 2.8" />
      <path d="M14 10.8H5.8M8.8 13.6l-3-2.8 3-2.8" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 10 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" {...base}>
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}
