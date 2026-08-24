/**
 * Persisted per-origin decisions for geolocation/camera/microphone access
 * (`userData/permissions.json`). Pure storage - the actual Electron
 * session hooks that consult/populate this live in permissions.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { PermissionCapability, PermissionDecision, SitePermissions } from '../shared/types';

interface PermissionsFile {
  sites: Record<string, SitePermissions>;
}

function permissionsFilePath(): string {
  return path.join(app.getPath('userData'), 'permissions.json');
}

function loadFromDisk(): Record<string, SitePermissions> {
  try {
    const raw = fs.readFileSync(permissionsFilePath(), 'utf-8');
    const data = JSON.parse(raw) as PermissionsFile;
    return data.sites ?? {};
  } catch {
    return {}; // no permissions file yet, or it's corrupt
  }
}

const sites = loadFromDisk();

function persist(): void {
  const data: PermissionsFile = { sites };
  fs.mkdirSync(path.dirname(permissionsFilePath()), { recursive: true });
  fs.writeFileSync(permissionsFilePath(), JSON.stringify(data), 'utf-8');
}

export function getDecision(origin: string, capability: PermissionCapability): PermissionDecision | undefined {
  return sites[origin]?.[capability];
}

export function setDecision(origin: string, capability: PermissionCapability, decision: PermissionDecision): void {
  sites[origin] = { ...sites[origin], origin, [capability]: decision };
  persist();
}

/** For the Settings > Permissions list - every origin with at least one
 * remembered decision. */
export function getAllSitePermissions(): SitePermissions[] {
  return Object.values(sites);
}

export function resetOrigin(origin: string): void {
  delete sites[origin];
  persist();
}
