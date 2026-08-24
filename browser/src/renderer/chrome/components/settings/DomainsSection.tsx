import { useState } from 'react';
import type { DomainTrustLists } from '../../../../shared/types';
import { normalizeDomain } from '../../../../shared/normalizeUrl';
import { PlusIcon, TrashIcon } from '../../icons';

interface DomainsSectionProps {
  domainTrust: DomainTrustLists;
  onSaveDomainTrust: (lists: DomainTrustLists) => void;
}

export function DomainsSection({ domainTrust, onSaveDomainTrust }: DomainsSectionProps) {
  return (
    <>
      <section className="settings-section">
        <h2>Domain trust</h2>
        <p className="settings-hint">
          Layered on top of the built-in phishing checks for links posted in chat: an untrusted domain is always
          masked, a trusted one is always clickable, regardless of the automatic heuristics.
        </p>
      </section>

      <DomainList
        title="Trusted domains"
        emptyHint="No trusted domains added."
        domains={domainTrust.trusted}
        onAdd={(domain) =>
          onSaveDomainTrust({
            trusted: [...domainTrust.trusted, domain],
            untrusted: domainTrust.untrusted.filter((d) => d !== domain),
          })
        }
        onRemove={(domain) =>
          onSaveDomainTrust({ trusted: domainTrust.trusted.filter((d) => d !== domain), untrusted: domainTrust.untrusted })
        }
      />

      <DomainList
        title="Untrusted domains"
        emptyHint="No untrusted domains added."
        domains={domainTrust.untrusted}
        onAdd={(domain) =>
          onSaveDomainTrust({
            untrusted: [...domainTrust.untrusted, domain],
            trusted: domainTrust.trusted.filter((d) => d !== domain),
          })
        }
        onRemove={(domain) =>
          onSaveDomainTrust({ untrusted: domainTrust.untrusted.filter((d) => d !== domain), trusted: domainTrust.trusted })
        }
      />
    </>
  );
}

interface DomainListProps {
  title: string;
  emptyHint: string;
  domains: string[];
  onAdd: (domain: string) => void;
  onRemove: (domain: string) => void;
}

function DomainList({ title, emptyHint, domains, onAdd, onRemove }: DomainListProps) {
  const [draft, setDraft] = useState('');
  const normalized = normalizeDomain(draft);
  const canAdd = normalized.length > 0 && !domains.includes(normalized);

  const submit = () => {
    if (!canAdd) return;
    onAdd(normalized);
    setDraft('');
  };

  return (
    <section className="settings-section">
      <h2>{title}</h2>
      <form
        className="settings-username"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input value={draft} spellCheck={false} placeholder="example.com" onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" disabled={!canAdd} aria-label="Add domain">
          <PlusIcon />
        </button>
      </form>

      {domains.length === 0 ? (
        <p className="settings-hint">{emptyHint}</p>
      ) : (
        <ul className="domain-chips">
          {domains.map((domain) => (
            <li key={domain} className="domain-chip">
              <span>{domain}</span>
              <button type="button" aria-label={`Remove ${domain}`} onClick={() => onRemove(domain)}>
                <TrashIcon size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
