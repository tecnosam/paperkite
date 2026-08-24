import type { AgentProvider } from '../../../shared/types';
import { PROVIDER_META } from '../../../shared/agentProviders';

interface ProviderBadgeProps {
  provider: AgentProvider;
  model: string;
}

/** Small pill identifying which provider + model an agent runs on - see
 * chrome's identical component (renderer/chrome/components/settings/ProviderBadge.tsx);
 * duplicated rather than shared because the chat and chrome renderers are
 * separate bundles with no shared component tree, only shared/ data. */
export function ProviderBadge({ provider, model }: ProviderBadgeProps) {
  const meta = PROVIDER_META[provider];
  return (
    <span className="provider-badge">
      <span className="provider-badge__dot" style={{ background: meta.color }} aria-hidden />
      <span className="provider-badge__name">{meta.label}</span>
      <span className="provider-badge__model">{model}</span>
    </span>
  );
}
