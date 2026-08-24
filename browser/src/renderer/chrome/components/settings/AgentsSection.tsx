import { useEffect, useState } from 'react';
import type { AgentConfig, AgentProvider } from '../../../../shared/types';
import { PROVIDER_META } from '../../../../shared/agentProviders';
import { EditIcon, TrashIcon } from '../../icons';
import { ProviderBadge } from './ProviderBadge';

const PROVIDER_ORDER: AgentProvider[] = ['claude', 'openai', 'gemini', 'ollama'];

export function AgentsSection() {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);

  useEffect(() => {
    const unsub = window.paperkite.onAgentsUpdated(setAgents);
    window.paperkite.requestAgents();
    return unsub;
  }, []);

  return (
    <>
      <section className="settings-section">
        <h2>AI agents</h2>
        <p className="settings-hint">
          Threads are private and page-independent. Use the camera button in a thread to attach a screenshot of your
          current page to a message - it's never sent automatically.
        </p>

        {agents.length === 0 ? (
          <p className="settings-hint">No agents configured yet.</p>
        ) : (
          <ul className="settings-list">
            {agents.map((agent) => (
              <li key={agent.id} className="settings-list__row">
                <div className="settings-list__main">
                  <span className="settings-list__title">{agent.name}</span>
                  <div className="agent-row__meta">
                    <ProviderBadge provider={agent.provider} model={agent.model} />
                    {!agent.hasCredential && agent.provider !== 'ollama' && (
                      <span className="agent-row__warning">No key on file</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="settings-list__delete"
                  aria-label={`Edit ${agent.name}`}
                  onClick={() => setEditingAgent(agent)}
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  className="settings-list__delete"
                  aria-label={`Remove ${agent.name}`}
                  onClick={() => {
                    if (editingAgent?.id === agent.id) setEditingAgent(null);
                    window.paperkite.deleteAgent(agent.id);
                  }}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AgentForm editingAgent={editingAgent} onDoneEditing={() => setEditingAgent(null)} />
    </>
  );
}

interface FormFields {
  provider: AgentProvider;
  name: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  systemPrompt: string;
}

function blankFields(): FormFields {
  return { provider: 'claude', name: '', model: '', apiKey: '', baseUrl: '', systemPrompt: '' };
}

interface AgentFormProps {
  editingAgent: AgentConfig | null;
  onDoneEditing: () => void;
}

function AgentForm({ editingAgent, onDoneEditing }: AgentFormProps) {
  const [fields, setFields] = useState<FormFields>(blankFields());

  useEffect(() => {
    setFields(
      editingAgent
        ? {
            provider: editingAgent.provider,
            name: editingAgent.name,
            model: editingAgent.model,
            apiKey: '',
            baseUrl: editingAgent.baseUrl ?? '',
            systemPrompt: editingAgent.systemPrompt ?? '',
          }
        : blankFields(),
    );
  }, [editingAgent]);

  const isOllama = fields.provider === 'ollama';
  // A brand-new non-Ollama agent needs a key up front (nothing to fall
  // back to); editing one can always be saved with the key field left
  // blank - see main/agentStore.ts's updateAgent "leave blank to keep
  // existing" convention.
  const canSave = fields.name.trim().length > 0 && fields.model.trim().length > 0 && (isOllama || !!editingAgent || fields.apiKey.trim().length > 0);
  const placeholder = PROVIDER_META[fields.provider].modelPlaceholder;

  const submit = () => {
    if (!canSave) return;
    const shared = {
      name: fields.name.trim(),
      model: fields.model.trim(),
      baseUrl: isOllama ? fields.baseUrl.trim() || undefined : undefined,
      systemPrompt: fields.systemPrompt.trim() || undefined,
    };
    if (editingAgent) {
      window.paperkite.updateAgent({ id: editingAgent.id, ...shared, apiKey: isOllama ? undefined : fields.apiKey.trim() || undefined });
    } else {
      window.paperkite.createAgent({ provider: fields.provider, ...shared, apiKey: isOllama ? undefined : fields.apiKey.trim() });
    }
    setFields(blankFields());
    onDoneEditing();
  };

  return (
    <section className="settings-section">
      <h2>{editingAgent ? `Edit "${editingAgent.name}"` : 'Add agent'}</h2>
      <form
        className="proxy-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {editingAgent ? (
          <div className="proxy-form__field--full">
            <p className="settings-hint">
              Provider: <strong>{PROVIDER_META[editingAgent.provider].label}</strong> - delete and re-add this agent
              to change it.
            </p>
          </div>
        ) : (
          <label className="proxy-form__field">
            <span>Provider</span>
            <select value={fields.provider} onChange={(e) => setFields((f) => ({ ...f, provider: e.target.value as AgentProvider }))}>
              {PROVIDER_ORDER.map((value) => (
                <option key={value} value={value}>
                  {PROVIDER_META[value].label}
                  {value === 'ollama' ? ' (local)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="proxy-form__field">
          <span>Name</span>
          <input
            value={fields.name}
            spellCheck={false}
            placeholder="Work Claude"
            onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))}
          />
        </label>

        <label className="proxy-form__field">
          <span>Model</span>
          <input
            value={fields.model}
            spellCheck={false}
            placeholder={placeholder}
            onChange={(e) => setFields((f) => ({ ...f, model: e.target.value }))}
          />
        </label>

        {isOllama ? (
          <label className="proxy-form__field">
            <span>Server address</span>
            <input
              value={fields.baseUrl}
              spellCheck={false}
              placeholder="http://localhost:11434"
              onChange={(e) => setFields((f) => ({ ...f, baseUrl: e.target.value }))}
            />
          </label>
        ) : (
          <label className="proxy-form__field">
            <span>API key</span>
            <input
              type="password"
              value={fields.apiKey}
              spellCheck={false}
              placeholder={editingAgent?.hasCredential ? 'Leave blank to keep existing key' : 'sk-...'}
              onChange={(e) => setFields((f) => ({ ...f, apiKey: e.target.value }))}
            />
          </label>
        )}

        <label className="proxy-form__field proxy-form__field--full">
          <span>Custom instructions (optional)</span>
          <textarea
            rows={3}
            value={fields.systemPrompt}
            spellCheck={false}
            placeholder="e.g. Always answer concisely. Prefer bullet points over prose."
            onChange={(e) => setFields((f) => ({ ...f, systemPrompt: e.target.value }))}
          />
        </label>

        <button type="submit" className="proxy-form__save" disabled={!canSave}>
          {editingAgent ? 'Save changes' : 'Add'}
        </button>
        {editingAgent && (
          <button type="button" className="settings-cancel-edit" onClick={onDoneEditing}>
            Cancel
          </button>
        )}
      </form>
    </section>
  );
}
