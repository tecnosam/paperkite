/**
 * Wires Electron's session-level permission hooks to permissionStore and
 * an interactive prompt flow. Kept separate from permissionStore itself
 * (pure persisted storage, no Electron API surface) since this module
 * owns live, unserializable state - the pending Electron `callback` for
 * whichever request is currently waiting on the user.
 */
import { session, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { getDecision, setDecision } from './permissionStore';
import type { PermissionCapability, PermissionRequestPayload } from '../shared/types';

/** Everything else Electron supports (notifications, MIDI, etc.) is
 * denied outright below - only what was actually asked for gets a UI. */
const HANDLED_PERMISSIONS = new Set(['geolocation', 'media']);

interface PendingRequest {
  callback: (allow: boolean) => void;
  origin: string;
  capabilities: PermissionCapability[];
}
const pending = new Map<string, PendingRequest>();

function originOf(webContents: WebContents, requestingUrl?: string): string | null {
  try {
    return new URL(requestingUrl ?? webContents.getURL()).origin;
  } catch {
    return null;
  }
}

/** Electron bundles camera+microphone under the single 'media' permission -
 * `mediaTypes` (present on 'media' requests) is what lets the prompt say
 * "camera", "microphone", or "camera and microphone" correctly instead of
 * a generic "media" label, and lets each be remembered independently. */
function capabilitiesFor(permission: string, mediaTypes?: Array<'video' | 'audio'>): PermissionCapability[] {
  if (permission === 'geolocation') return ['geolocation'];
  if (permission === 'media') {
    const types = mediaTypes && mediaTypes.length > 0 ? mediaTypes : ['video', 'audio'];
    const capabilities: PermissionCapability[] = [];
    if (types.includes('video')) capabilities.push('camera');
    if (types.includes('audio')) capabilities.push('microphone');
    return capabilities;
  }
  return [];
}

/** Registers the two session-level hooks once at startup. `onPromptNeeded`
 * is how main tells the chrome renderer to show the Allow/Block bubble -
 * see main/index.ts for the wiring and ipc.ts's PERMISSION_RESPONSE
 * handler for resolvePermissionRequest() below.
 *
 * `isTrustedWebContents` identifies Paperkite's own chrome view specifically
 * (see main/index.ts) - its own getDisplayMedia call for live translate's
 * tab-audio capture (see renderer/chrome/audioCapture.ts) triggers this
 * same session-wide 'media' permission hook, since Electron doesn't
 * distinguish "screen/tab capture" from "camera/mic" at this layer. That
 * request is for Paperkite's own first-party, non-navigable chrome UI, not
 * an arbitrary website asking for camera/mic - the Allow/Block prompt this
 * module exists for is about the latter, so the former skips it and is
 * granted outright. Confirmed by hand as a real, not hypothetical, bug:
 * this could silently block live translate entirely behind a prompt
 * nothing ever answers, and in dev mode specifically, a "remember this
 * choice" grant doesn't reliably survive across restarts anyway, since the
 * chrome renderer's origin (its dev server's port) can change between
 * runs when the default port is already taken. */
export function installPermissionHandlers(
  onPromptNeeded: (request: PermissionRequestPayload) => void,
  isTrustedWebContents: (webContents: WebContents) => boolean,
): void {
  // Reflects already-remembered decisions for synchronous-style checks
  // (e.g. navigator.permissions.query) - never itself triggers a prompt.
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    const capabilities = capabilitiesFor(permission);
    if (capabilities.length === 0) return false;
    return capabilities.every((capability) => getDecision(requestingOrigin, capability) === 'granted');
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (!HANDLED_PERMISSIONS.has(permission)) {
      callback(false);
      return;
    }
    if (permission === 'media' && isTrustedWebContents(webContents)) {
      callback(true);
      return;
    }
    const origin = originOf(webContents, details.requestingUrl);
    const capabilities = capabilitiesFor(permission, 'mediaTypes' in details ? details.mediaTypes : undefined);
    if (!origin || capabilities.length === 0) {
      callback(false);
      return;
    }

    const decisions = capabilities.map((capability) => getDecision(origin, capability));
    if (decisions.every((d) => d === 'granted')) {
      callback(true);
      return;
    }
    if (decisions.some((d) => d === 'denied')) {
      callback(false);
      return;
    }

    const requestId = randomUUID();
    pending.set(requestId, { callback, origin, capabilities });
    onPromptNeeded({ requestId, origin, capabilities });
  });
}

/** Called from the PERMISSION_RESPONSE IPC handler once the user answers
 * the bubble. No-ops if the request already resolved or never existed
 * (e.g. a stale response after the app restarted). */
export function resolvePermissionRequest(requestId: string, allow: boolean, remember: boolean): void {
  const request = pending.get(requestId);
  if (!request) return;
  pending.delete(requestId);
  request.callback(allow);
  if (remember) {
    for (const capability of request.capabilities) {
      setDecision(request.origin, capability, allow ? 'granted' : 'denied');
    }
  }
}
