/**
 * Persists manual proxy configuration to `userData/proxy.json`, mirroring
 * userStore.ts's theme-file pattern (own small file, own load/save pair),
 * and applies it to the default session.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, session } from 'electron';
import type { ProxySettings } from '../shared/types';
import { DEFAULT_PROXY_SETTINGS } from '../shared/types';

function proxyFilePath(): string {
  return path.join(app.getPath('userData'), 'proxy.json');
}

export function loadProxySettings(): ProxySettings {
  try {
    const raw = fs.readFileSync(proxyFilePath(), 'utf-8');
    const data = JSON.parse(raw) as Partial<ProxySettings>;
    return { ...DEFAULT_PROXY_SETTINGS, ...data };
  } catch {
    return { ...DEFAULT_PROXY_SETTINGS };
  }
}

export function saveProxySettings(settings: ProxySettings): void {
  fs.mkdirSync(path.dirname(proxyFilePath()), { recursive: true });
  fs.writeFileSync(proxyFilePath(), JSON.stringify(settings), 'utf-8');
}

/** Builds the `proxyRules` string Electron's session.setProxy() expects
 * from our simpler {protocol, host, port} shape - e.g. "socks5=host:port". */
export function buildProxyRules(settings: ProxySettings): string {
  return `${settings.protocol}=${settings.host}:${settings.port}`;
}

/** Applies proxy settings to the default session - every tab's
 * WebContentsView uses defaultSession since none of them are created
 * with a `partition`, so this covers all page loads. */
export function applyProxySettings(settings: ProxySettings): Promise<void> {
  if (settings.mode === 'direct' || !settings.host || !settings.port) {
    return session.defaultSession.setProxy({ mode: 'direct' });
  }
  return session.defaultSession.setProxy({
    proxyRules: buildProxyRules(settings),
    proxyBypassRules: settings.bypassList,
  });
}
