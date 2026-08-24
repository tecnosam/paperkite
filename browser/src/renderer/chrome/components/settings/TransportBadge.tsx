import type { McpTransport } from '../../../../shared/types';

interface TransportBadgeProps {
  transport: McpTransport;
  detail: string;
}

const TRANSPORT_META: Record<McpTransport, { label: string; color: string }> = {
  stdio: { label: 'stdio', color: '#5c5548' },
  http: { label: 'http', color: 'var(--sky)' },
};

/** Same visual shape as ProviderBadge (color-coded dot + label + mono
 * detail) - reuses its `.provider-badge*` CSS directly rather than
 * duplicating it, since the two are structurally identical. */
export function TransportBadge({ transport, detail }: TransportBadgeProps) {
  const meta = TRANSPORT_META[transport];
  return (
    <span className="provider-badge">
      <span className="provider-badge__dot" style={{ background: meta.color }} aria-hidden />
      <span className="provider-badge__name">{meta.label}</span>
      <span className="provider-badge__model">{detail}</span>
    </span>
  );
}
