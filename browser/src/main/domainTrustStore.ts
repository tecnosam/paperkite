/**
 * User-managed domain trust lists, layered on top of the built-in
 * heuristics in shared/linkSafety.ts (see that file's classifyLink()).
 * Persisted to `userData/domainTrust.json`. Membership in the two lists
 * is mutually exclusive - adding a domain to one removes it from the
 * other, enforced here rather than trusted to callers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { DomainTrustLists } from '../shared/types';
import { DEFAULT_DOMAIN_TRUST_LISTS } from '../shared/types';

function domainTrustFilePath(): string {
  return path.join(app.getPath('userData'), 'domainTrust.json');
}

function loadFromDisk(): DomainTrustLists {
  try {
    const raw = fs.readFileSync(domainTrustFilePath(), 'utf-8');
    const data = JSON.parse(raw) as Partial<DomainTrustLists>;
    return {
      trusted: Array.isArray(data.trusted) ? data.trusted : [],
      untrusted: Array.isArray(data.untrusted) ? data.untrusted : [],
    };
  } catch {
    return { ...DEFAULT_DOMAIN_TRUST_LISTS };
  }
}

let lists = loadFromDisk();

function persist(): void {
  fs.mkdirSync(path.dirname(domainTrustFilePath()), { recursive: true });
  fs.writeFileSync(domainTrustFilePath(), JSON.stringify(lists), 'utf-8');
}

export function getDomainTrustLists(): DomainTrustLists {
  return lists;
}

export function setDomainTrustLists(next: DomainTrustLists): void {
  lists = next;
  persist();
}
