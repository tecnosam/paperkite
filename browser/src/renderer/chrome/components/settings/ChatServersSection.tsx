import { useEffect, useRef, useState } from 'react';
import type { ChatServerConfig, AddChatServerPayload, ChatServerUsernameClaimResult } from '../../../../shared/types';
import { EditIcon, TrashIcon, StarIcon, CheckIcon } from '../../icons';

interface ChatServersSectionProps {
  /** Set when Settings was opened via the chat panel's "fix this server's
   * username" CTA - see SettingsModal.tsx's own doc comment on the same
   * props. `null` for a normal visit to this section. */
  focusServerId: string | null;
  focusToken: number;
}

export function ChatServersSection({ focusServerId, focusToken }: ChatServersSectionProps) {
  const [servers, setServers] = useState<ChatServerConfig[]>([]);
  const [defaultServerId, setDefaultServerId] = useState<string | null>(null);
  const [editingServer, setEditingServer] = useState<ChatServerConfig | null>(null);

  useEffect(() => {
    const unsub = window.paperkite.onChatServersUpdated((payload) => {
      setServers(payload.servers);
      setDefaultServerId(payload.defaultServerId);
    });
    window.paperkite.requestChatServers();
    return unsub;
  }, []);

  // Keep the open edit form in sync with the live list - e.g. once a
  // claim succeeds, `editingServer` (a snapshot from when Edit was
  // clicked) would otherwise still show the old, unset username.
  useEffect(() => {
    if (!editingServer) return;
    const fresh = servers.find((s) => s.id === editingServer.id);
    if (fresh && fresh !== editingServer) setEditingServer(fresh);
  }, [servers, editingServer]);

  // Depends on `servers` too, not just focusToken - if the CTA fires
  // before the server list has actually loaded yet, this re-checks once
  // it does instead of silently missing the deep-link.
  useEffect(() => {
    if (!focusServerId || focusToken === 0) return;
    const target = servers.find((s) => s.id === focusServerId);
    if (target) setEditingServer(target);
  }, [focusServerId, focusToken, servers]);

  return (
    <>
      <section className="settings-section">
        <h2>Chat servers</h2>
        <p className="settings-hint">
          Paperkite's page chat is a client of an external chat server (see chat-service) - your copy of the browser
          connects to whichever one's picked here. The default is what every tab joins unless it's switched from the
          picker in the chat panel's own header. Your username is set per server, not globally - each one may enforce
          its own uniqueness, so the same name isn't guaranteed to be free everywhere. Once claimed, a username can't
          be changed - usernames are held permanently by whoever claims them first.
        </p>

        {servers.length === 0 ? (
          <p className="settings-hint">No chat servers configured yet.</p>
        ) : (
          <ul className="settings-list">
            {servers.map((server) => (
              <li key={server.id} className="settings-list__row">
                <div className="settings-list__main">
                  <span className="settings-list__title">{server.name}</span>
                  <span className="settings-list__url">{server.baseUrl}</span>
                  <span className={'settings-list__username' + (server.username ? '' : ' settings-list__username--unset')}>
                    {server.username ?? 'No username set'}
                  </span>
                </div>
                <button
                  type="button"
                  className={'settings-list__delete' + (server.id === defaultServerId ? ' settings-list__delete--active' : '')}
                  aria-label={server.id === defaultServerId ? `${server.name} is the default` : `Make ${server.name} the default`}
                  title={server.id === defaultServerId ? 'Default server' : 'Set as default'}
                  disabled={server.id === defaultServerId}
                  onClick={() => window.paperkite.setDefaultChatServer(server.id)}
                >
                  <StarIcon filled={server.id === defaultServerId} />
                </button>
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
                    window.paperkite.deleteChatServer(server.id);
                  }}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ChatServerForm servers={servers} editingServer={editingServer} onDoneEditing={() => setEditingServer(null)} />
    </>
  );
}

interface FormFields {
  name: string;
  baseUrl: string;
}

function blankFields(): FormFields {
  return { name: '', baseUrl: '' };
}

function normalizeUrlForCompare(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

interface ChatServerFormProps {
  servers: ChatServerConfig[];
  editingServer: ChatServerConfig | null;
  onDoneEditing: () => void;
}

function ChatServerForm({ servers, editingServer, onDoneEditing }: ChatServerFormProps) {
  const [fields, setFields] = useState<FormFields>(blankFields());

  useEffect(() => {
    setFields(editingServer ? { name: editingServer.name, baseUrl: editingServer.baseUrl } : blankFields());
  }, [editingServer]);

  const isDuplicateUrl =
    fields.baseUrl.trim().length > 0 &&
    servers.some((s) => s.id !== editingServer?.id && normalizeUrlForCompare(s.baseUrl) === normalizeUrlForCompare(fields.baseUrl));

  const canSave = fields.name.trim().length > 0 && fields.baseUrl.trim().length > 0 && !isDuplicateUrl;

  const buildDraft = (): AddChatServerPayload => ({
    name: fields.name.trim(),
    baseUrl: fields.baseUrl.trim(),
  });

  const submit = () => {
    if (!canSave) return;
    if (editingServer) {
      window.paperkite.updateChatServer({ id: editingServer.id, ...buildDraft() });
    } else {
      window.paperkite.createChatServer(buildDraft());
    }
    setFields(blankFields());
    onDoneEditing();
  };

  return (
    <section className="settings-section">
      <h2>{editingServer ? `Edit "${editingServer.name}"` : 'Add chat server'}</h2>

      <form
        className="proxy-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="proxy-form__field">
          <span>Name</span>
          <input value={fields.name} spellCheck={false} placeholder="Local" onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))} />
        </label>

        <label className="proxy-form__field">
          <span>URL</span>
          <input
            value={fields.baseUrl}
            spellCheck={false}
            placeholder="http://localhost:8080"
            onChange={(e) => setFields((f) => ({ ...f, baseUrl: e.target.value }))}
          />
        </label>
        {isDuplicateUrl && <p className="username-claim__error proxy-form__field--full">A server with this URL is already configured.</p>}

        {editingServer && (
          <div className="proxy-form__field--full">
            <ChatServerUsernameField server={editingServer} />
          </div>
        )}

        <button type="submit" className="proxy-form__save" disabled={!canSave}>
          {editingServer ? 'Save changes' : 'Add server'}
        </button>
        {editingServer && (
          <button type="button" className="settings-cancel-edit" onClick={onDoneEditing}>
            Cancel
          </button>
        )}
      </form>
    </section>
  );
}

type ClaimStatus = 'idle' | 'pending' | 'taken' | 'error';

/** The username claim itself is server-owned, not just a form field this
 * app persists (see chatServerStore.ts's setChatServerUsername) - typing
 * a name here actually asks the real server whether it's free, the same
 * POST /connect claim a real page-chat connect would make, and stores
 * whatever the server hands back. Once `server.username` is set this
 * always renders read-only instead - see ChatServersSection's own
 * settings-hint on why a username can never change once claimed. */
function ChatServerUsernameField({ server }: { server: ChatServerConfig }) {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<ClaimStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUsernameRef = useRef<string | null>(null);

  useEffect(() => {
    return window.paperkite.onChatServerUsernameClaimResult((result: ChatServerUsernameClaimResult) => {
      // Guards against a stale response for a claim the user has since
      // moved past (typed something else, or switched servers) - only
      // the most recently *sent* attempt for this exact server matters.
      if (result.serverId !== server.id || result.username !== pendingUsernameRef.current) return;
      if (result.ok) {
        // No local success state needed - the server list broadcast that
        // comes with a successful claim updates `server.username` itself,
        // which flips this component into its read-only branch below
        // (with its own permanent checkmark) on the very next render.
        setStatus('idle');
      } else {
        setStatus(result.reason === 'taken' ? 'taken' : 'error');
        setMessage(result.message ?? null);
      }
    });
  }, [server.id]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const claim = (username: string) => {
    const trimmed = username.trim();
    if (!trimmed) {
      setStatus('idle');
      setMessage(null);
      return;
    }
    pendingUsernameRef.current = trimmed;
    setStatus('pending');
    setMessage(null);
    window.paperkite.claimChatServerUsername({ serverId: server.id, username: trimmed });
  };

  const onChange = (next: string) => {
    setValue(next);
    setStatus('idle');
    setMessage(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => claim(next), 600);
  };

  const onBlur = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    claim(value);
  };

  if (server.username) {
    return (
      <label className="proxy-form__field proxy-form__field--full">
        <span>Your username on this server</span>
        <div className="username-claim__row">
          <input value={server.username} disabled readOnly />
          <span className="username-claim__check username-claim__check--set" aria-label="Claimed">
            <CheckIcon size={13} />
          </span>
        </div>
        <p className="settings-hint">Permanent once claimed - this can't be changed here.</p>
      </label>
    );
  }

  return (
    <label className="proxy-form__field proxy-form__field--full">
      <span>Your username on this server</span>
      <div className="username-claim__row">
        <input
          value={value}
          spellCheck={false}
          placeholder="Not set"
          disabled={status === 'pending'}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              claim(value);
            }
          }}
        />
        {status === 'pending' && <span className="spinner" aria-label="Checking availability" />}
      </div>
      {(status === 'taken' || status === 'error') && (
        <p className="username-claim__error">{message ?? (status === 'taken' ? 'Username already claimed, try another' : 'Something went wrong, try again')}</p>
      )}
      <p className="settings-hint">
        Usually claimed permanently the first time it's used - if this server rejects it as taken, pick a different
        one here.
      </p>
    </label>
  );
}
