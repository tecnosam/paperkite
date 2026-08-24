/** Small inline stroke icon, matching the chrome view's icon style. */
type IconProps = { size?: number; filled?: boolean };

export function PinIcon({ size = 15, filled = false }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      stroke="currentColor"
      fill={filled ? 'currentColor' : 'none'}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.5 2.5h3l.5 4.5 2 2v1.5h-8V9l2-2z" />
      <path d="M8 10.5V14" />
    </svg>
  );
}

export function RetryIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 8A5 5 0 1 1 11.5 4.3" />
      <path d="M13 2.5V5.5H10" />
    </svg>
  );
}

export function CameraIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 5.5h2l1-1.5h5l1 1.5h2v7h-11z" />
      <circle cx="8" cy="9" r="2.2" />
    </svg>
  );
}

export function CloseIcon({ size = 11 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function DownloadIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 12.5h10" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 8h11M9 4l4 4-4 4" />
    </svg>
  );
}

export function BackIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3 5 8l5 5" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export function PlusIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function TrashIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.5h10M6.2 4.5V3a.8.8 0 0 1 .8-.8h2a.8.8 0 0 1 .8.8v1.5M4.5 4.5l.6 8.4a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.4" />
    </svg>
  );
}

export function StopIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.2" />
    </svg>
  );
}

export function ChatBubbleIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" strokeLinejoin="round" />
    </svg>
  );
}

export function ServerIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="11" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="11" height="4.5" rx="1" />
      <circle cx="5" cy="4.75" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="5" cy="11.25" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SparkleIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" stroke="currentColor" fill="none" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2.2c.4 2.3 1 3.1 3.5 3.5-2.5.4-3.1 1.2-3.5 3.5-.4-2.3-1-3.1-3.5-3.5C7 5.3 7.6 4.5 8 2.2z" strokeLinejoin="round" />
      <path d="M12.7 9.8c.24 1.28.6 1.66 1.8 1.9-1.2.24-1.56.62-1.8 1.9-.24-1.28-.6-1.66-1.8-1.9 1.2-.24 1.56-.62 1.8-1.9z" strokeLinejoin="round" />
    </svg>
  );
}
