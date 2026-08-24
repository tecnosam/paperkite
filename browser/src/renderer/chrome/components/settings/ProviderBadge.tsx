import type { AgentProvider } from '../../../../shared/types';
import { PROVIDER_META } from '../../../../shared/agentProviders';

interface ProviderBadgeProps {
  provider: AgentProvider;
  model: string;
}

/** Small pill identifying which provider + model an agent runs on - a
 * color-coded dot (see PROVIDER_META) plus the model name in mono, so
 * it reads at a glance without needing to open the agent's settings. */
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
