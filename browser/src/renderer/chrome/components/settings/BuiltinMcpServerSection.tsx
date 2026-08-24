import { useEffect, useState } from 'react';
import type { McpScope, McpTokenInfo, BuiltinMcpServerStatus, CreateMcpTokenResult } from '../../../../shared/types';
import { TrashIcon } from '../../icons';

interface ScopeGroup {
  label: string;
  read: McpScope;
  write?: McpScope;
}

const SCOPE_GROUPS: ScopeGroup[] = [
  { label: 'Bookmarks', read: 'bookmarks:read', write: 'bookmarks:write' },
  { label: 'History', read: 'history:read', write: 'history:write' },
  { label: 'Domains', read: 'domains:read', write: 'domains:write' },
  { label: 'Proxy', read: 'proxy:read' },
  { label: 'Tabs', read: 'tabs:read', write: 'tabs:write' },
];

const SCOPE_LABELS: Record<McpScope, string> = {
  'bookmarks:read': 'Bookmarks: read',
  'bookmarks:write': 'Bookmarks: write',
  'history:read': 'History: read',
  'history:write': 'History: write',
  'domains:read': 'Domains: read',
  'domains:write': 'Domains: write',
  'proxy:read': 'Proxy: read',
  'tabs:read': 'Tabs: read',
  'tabs:write': 'Tabs: write',
};

/** Settings > MCP's "let other apps control Paperkite" section - the
 * reverse of the rest of that page (which configures servers *this app*
 * connects out to). See main/mcp/builtinServer.ts + main/mcpAuth.ts. */
export function BuiltinMcpServerSection() {
  const [status, setStatus] = useState<BuiltinMcpServerStatus>({ enabled: false, port: null, url: null });
  const [tokens, setTokens] = useState<McpTokenInfo[]>([]);
  const [justCreated, setJustCreated] = useState<CreateMcpTokenResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    const unsubs = [
      window.paperkite.onBuiltinMcpStatus(setStatus),
      window.paperkite.onMcpTokensUpdated(setTokens),
      window.paperkite.onMcpTokenCreated(setJustCreated),
    ];
    window.paperkite.requestBuiltinMcpStatus();
    window.paperkite.requestMcpTokens();
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
  };

  return (
    <section className="settings-section">
      <h2>Paperkite's MCP server</h2>
      <p className="settings-hint">
        Lets other apps - Claude Desktop, for example - control this browser: open and manage tabs, read history,
        manage bookmarks and trusted domains, and check (never change) the proxy. Paperkite's own agent chat always
        has access; anything else needs a token below.
      </p>

      <div className="settings-toggle">
        <div className="settings-toggle__text">
          <span className="settings-toggle__label">Let other apps control Paperkite</span>
          <span className="settings-toggle__desc">{status.enabled ? `Listening at ${status.url}` : 'Currently off.'}</span>
        </div>
        <button
          type="button"
          className={'switch' + (status.enabled ? ' switch--on' : '')}
          role="switch"
          aria-checked={status.enabled}
          onClick={() => window.paperkite.setBuiltinMcpEnabled(!status.enabled)}
        >
          <span className="switch__thumb" />
        </button>
      </div>

      {status.enabled && status.url && (
        <ConnectionUrl url={status.url} copiedKey={copiedKey} onCopy={copy} />
      )}

      {justCreated && (
        <div className="mcp-token-reveal">
          <p className="settings-hint">
            Copy this token now - for your security, you won't be able to see it again. Paste it as an{' '}
            <code>Authorization: Bearer &lt;token&gt;</code> header, or into whatever client's MCP config asks for a token.
          </p>
          <div className="mcp-copy-row">
            <code className="mcp-copy-row__jwt">{justCreated.jwt}</code>
            <button type="button" className="settings-cancel-edit" onClick={() => copy(justCreated.jwt, 'jwt')}>
              {copiedKey === 'jwt' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button type="button" className="settings-cancel-edit" onClick={() => setJustCreated(null)}>
            Done
          </button>
        </div>
      )}

      <ul className="settings-list">
        {tokens.map((token) => (
          <li key={token.jti} className="settings-list__row">
            <div className="settings-list__main">
              <span className="settings-list__title">{token.label}</span>
              <div className="mcp-token-scopes">
                {token.scopes.map((scope) => (
                  <span key={scope} className="mcp-scope-pill">
                    {SCOPE_LABELS[scope]}
                  </span>
                ))}
              </div>
              <span className="settings-list__url">{token.expiresAt ? `Expires ${new Date(token.expiresAt).toLocaleString()}` : 'Never expires'}</span>
            </div>
            {!token.internal && (
              <button
                type="button"
                className="settings-list__delete"
                aria-label={`Revoke ${token.label}`}
                onClick={() => window.paperkite.revokeMcpToken(token.jti)}
              >
                <TrashIcon />
              </button>
            )}
          </li>
        ))}
      </ul>

      <NewTokenForm />
    </section>
  );
}

function ConnectionUrl({ url, copiedKey, onCopy }: { url: string; copiedKey: string | null; onCopy: (text: string, key: string) => void }) {
  return (
    <div className="mcp-copy-row">
      <code>{url}</code>
      <button type="button" className="settings-cancel-edit" onClick={() => onCopy(url, 'url')}>
        {copiedKey === 'url' ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

const TTL_OPTIONS: Array<{ value: string; label: string; ms: number | null }> = [
  { value: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
  { value: '1d', label: '1 day', ms: 24 * 60 * 60 * 1000 },
  { value: '7d', label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { value: '30d', label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { value: 'never', label: 'Never expires', ms: null },
];

function NewTokenForm() {
  const [label, setLabel] = useState('');
  const [scopes, setScopes] = useState<ReadonlySet<McpScope>>(new Set());
  const [ttl, setTtl] = useState('never');

  const toggleScope = (scope: McpScope) => {
    setScopes((current) => {
      const next = new Set(current);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const canGenerate = label.trim().length > 0 && scopes.size > 0;

  const submit = () => {
    if (!canGenerate) return;
    const ttlMs = TTL_OPTIONS.find((o) => o.value === ttl)?.ms ?? null;
    window.paperkite.createMcpToken({ label: label.trim(), scopes: [...scopes], ttlMs });
    setLabel('');
    setScopes(new Set());
    setTtl('never');
  };

  return (
    <form
      className="proxy-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="proxy-form__field">
        <span>Label</span>
        <input value={label} spellCheck={false} placeholder="Claude Desktop" onChange={(e) => setLabel(e.target.value)} />
      </label>

      <label className="proxy-form__field">
        <span>Expires</span>
        <select value={ttl} onChange={(e) => setTtl(e.target.value)}>
          {TTL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <div className="proxy-form__field--full mcp-scope-grid">
        {SCOPE_GROUPS.map((group) => {
          const writeScope = group.write;
          return (
            <div key={group.label} className="mcp-scope-group">
              <span className="mcp-scope-group__label">{group.label}</span>
              <label className="mcp-scope-checkbox">
                <input type="checkbox" checked={scopes.has(group.read)} onChange={() => toggleScope(group.read)} />
                Read
              </label>
              {writeScope && (
                <label className="mcp-scope-checkbox">
                  <input type="checkbox" checked={scopes.has(writeScope)} onChange={() => toggleScope(writeScope)} />
                  Write
                </label>
              )}
            </div>
          );
        })}
      </div>

      <button type="submit" className="proxy-form__save" disabled={!canGenerate}>
        Generate token
      </button>
    </form>
  );
}
