/**
 * Display metadata for each agent provider - label, identity color (for the
 * small provider-badge dot shown next to an agent's model wherever it
 * appears: Settings, the thread list, and the conversation header), and
 * the model-field placeholder shown in the "Add agent" form. Centralized
 * so all three surfaces stay in sync instead of drifting.
 */
import type { AgentProvider } from './types';

export interface ProviderMeta {
  label: string;
  /** Identity color for the provider-badge dot - picked to sit clearly
   * apart from the app's own semantic colors (kite-red accent, sky-blue
   * links) so a badge is never mistaken for an interactive/status color. */
  color: string;
  modelPlaceholder: string;
}

export const PROVIDER_META: Record<AgentProvider, ProviderMeta> = {
  claude: { label: 'Claude', color: '#c1663d', modelPlaceholder: 'claude-sonnet-5' },
  openai: { label: 'OpenAI', color: '#2f8f6f', modelPlaceholder: 'gpt-5' },
  gemini: { label: 'Gemini', color: '#7b6fd1', modelPlaceholder: 'gemini-2.5-flash' },
  ollama: { label: 'Ollama', color: '#b8860b', modelPlaceholder: 'llama3.2' },
};
