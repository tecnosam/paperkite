import { useEffect, useState } from 'react';
import type { McpServerConfig, McpTransport, AddMcpServerPayload, McpTestResult } from '../../../../shared/types';
import { EditIcon, TrashIcon } from '../../icons';
import { TransportBadge } from './TransportBadge';
import { BuiltinMcpServerSection } from './BuiltinMcpServerSection';

export function McpSection() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null);

  useEffect(() => {
    const unsub = window.paperkite.onMcpServersUpdated(setServers);
    window.paperkite.requestMcpServers();
    return unsub;
  }, []);

  return (
    <>
      <section className="settings-section">
        <h2>MCP servers</h2>
        <p className="settings-hint">
          A connected server's tools are offered to every agent thread automatically - the model decides on its own,
          per message, whether it needs to call one (e.g. "order these ingredients" might call a Glovo server's
          ordering tool).
        </p>

        {servers.length === 0 ? (
          <p className="settings-hint">No MCP servers configured yet.</p>
        ) : (
          <ul className="settings-list">
            {servers.map((server) => (
              <li key={server.id} className="settings-list__row">
                <div className="settings-list__main">
                  <span className="settings-list__title">{server.name}</span>
                  <div className="agent-row__meta">
                    <TransportBadge
                      transport={server.transport}
                      detail={server.transport === 'stdio' ? [server.command, ...(server.args ?? [])].filter(Boolean).join(' ') : (server.url ?? '')}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="settings-list__delete"
                  aria-label={`Edit ${server.name}`}
                  onClick={() => setEditingServer(server)}
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  className="settings-list__delete"
                  aria-label={`Remove ${server.name}`}
                  onClick={() => {
                    if (editingServer?.id === server.id) setEditingServer(null);
                    window.paperkite.deleteMcpServer(server.id);
                  }}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <McpServerForm editingServer={editingServer} onDoneEditing={() => setEditingServer(null)} />

      <BuiltinMcpServerSection />
    </>
  );
}

interface FormFields {
  transport: McpTransport;
  name: string;
  command: string;
  args: string;
  url: string;
  envText: string;
  authHeader: string;
}

function blankFields(): FormFields {
  return { transport: 'stdio', name: '', command: '', args: '', url: '', envText: '', authHeader: '' };
}

/** `KEY=value` per line -> a plain object; blank/malformed lines are
 * skipped rather than rejected, and an entirely empty result comes back
 * as `undefined` so the "leave blank to keep existing" convention (see
 * main/mcpStore.ts's updateMcpServer) works without extra plumbing here. */
function parseEnvText(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key) env[key] = line.slice(eq + 1).trim();
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

interface McpServerFormProps {
  editingServer: McpServerConfig | null;
  onDoneEditing: () => void;
}

function McpServerForm({ editingServer, onDoneEditing }: McpServerFormProps) {
  const [fields, setFields] = useState<FormFields>(blankFields());
  const [testResult, setTestResult] = useState<McpTestResult | 'testing' | null>(null);

  useEffect(() => {
    setFields(
      editingServer
        ? {
            transport: editingServer.transport,
            name: editingServer.name,
            command: editingServer.command ?? '',
            args: (editingServer.args ?? []).join(' '),
            url: editingServer.url ?? '',
            envText: '',
            authHeader: '',
          }
        : blankFields(),
    );
    setTestResult(null);
  }, [editingServer]);

  useEffect(() => window.paperkite.onMcpServerTestResult(setTestResult), []);

  const isStdio = fields.transport === 'stdio';
  const canSave = fields.name.trim().length > 0 && (isStdio ? fields.command.trim().length > 0 : fields.url.trim().length > 0);

  const buildDraft = (): AddMcpServerPayload => ({
    name: fields.name.trim(),
    transport: fields.transport,
    command: isStdio ? fields.command.trim() : undefined,
    args: isStdio ? fields.args.trim().split(/\s+/).filter(Boolean) : undefined,
    url: isStdio ? undefined : fields.url.trim(),
    env: isStdio ? parseEnvText(fields.envText) : undefined,
    authHeader: isStdio ? undefined : fields.authHeader.trim() || undefined,
  });

  const test = () => {
    if (!canSave) return;
    setTestResult('testing');
    window.paperkite.testMcpServer(buildDraft());
  };

  const submit = () => {
    if (!canSave) return;
    if (editingServer) {
      window.paperkite.updateMcpServer({ id: editingServer.id, ...buildDraft() });
    } else {
      window.paperkite.createMcpServer(buildDraft());
    }
    setFields(blankFields());
    setTestResult(null);
    onDoneEditing();
  };

  return (
    <section className="settings-section">
      <h2>{editingServer ? `Edit "${editingServer.name}"` : 'Add MCP server'}</h2>

      <form
        className="proxy-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="proxy-form__field--full">
          {editingServer ? (
            <p className="settings-hint">
              Transport: <strong>{editingServer.transport === 'stdio' ? 'local command' : 'remote URL'}</strong> -
              delete and re-add this server to change it.
            </p>
          ) : (
            <div className="segmented" role="radiogroup" aria-label="Transport">
              {(['stdio', 'http'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={fields.transport === t}
                  className={'segmented__option' + (fields.transport === t ? ' segmented__option--active' : '')}
                  onClick={() => setFields((f) => ({ ...f, transport: t }))}
                >
                  {t === 'stdio' ? 'Local command' : 'Remote URL'}
                </button>
              ))}
            </div>
          )}
        </div>

        <label className="proxy-form__field">
          <span>Name</span>
          <input value={fields.name} spellCheck={false} placeholder="Glovo" onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))} />
        </label>

        {isStdio ? (
          <>
            <label className="proxy-form__field">
              <span>Command</span>
              <input
                value={fields.command}
                spellCheck={false}
                placeholder="npx"
                onChange={(e) => setFields((f) => ({ ...f, command: e.target.value }))}
              />
            </label>
            <label className="proxy-form__field">
              <span>Arguments</span>
              <input
                value={fields.args}
                spellCheck={false}
                placeholder="-y @some/mcp-server"
                onChange={(e) => setFields((f) => ({ ...f, args: e.target.value }))}
              />
            </label>
          </>
        ) : (
          <label className="proxy-form__field">
            <span>URL</span>
            <input
              value={fields.url}
              spellCheck={false}
              placeholder="https://mcp.example.com"
              onChange={(e) => setFields((f) => ({ ...f, url: e.target.value }))}
            />
          </label>
        )}

        <label className="proxy-form__field proxy-form__field--full">
          <span>{isStdio ? 'Environment variables' : 'Authorization header'}</span>
          {isStdio ? (
            <textarea
              rows={3}
              value={fields.envText}
              spellCheck={false}
              placeholder={editingServer?.hasSecrets ? 'Leave blank to keep the existing variables' : 'KEY=value\nANOTHER_KEY=value'}
              onChange={(e) => setFields((f) => ({ ...f, envText: e.target.value }))}
            />
          ) : (
            <input
              type="password"
              value={fields.authHeader}
              spellCheck={false}
              placeholder={editingServer?.hasSecrets ? 'Leave blank to keep the existing header' : 'Bearer sk-...'}
              onChange={(e) => setFields((f) => ({ ...f, authHeader: e.target.value }))}
            />
          )}
        </label>

        <button type="button" className="proxy-form__save" disabled={!canSave} onClick={test}>
          Test connection
        </button>
        <button type="submit" className="proxy-form__save" disabled={!canSave}>
          {editingServer ? 'Save changes' : 'Add server'}
        </button>
        {editingServer && (
          <button type="button" className="settings-cancel-edit" onClick={onDoneEditing}>
            Cancel
          </button>
        )}
      </form>

      {testResult && (
        <p className={'mcp-test-result' + (testResult !== 'testing' && !testResult.ok ? ' mcp-test-result--error' : '')}>
          {testResult === 'testing'
            ? 'Testing…'
            : testResult.ok
              ? `✓ ${testResult.toolCount} tool${testResult.toolCount === 1 ? '' : 's'} found`
              : `✗ ${testResult.error}`}
        </p>
      )}
    </section>
  );
}
