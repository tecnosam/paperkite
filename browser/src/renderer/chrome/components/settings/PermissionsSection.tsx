import { useEffect, useState } from 'react';
import type { PermissionCapability, SitePermissions } from '../../../../shared/types';
import { TrashIcon } from '../../icons';

const CAPABILITIES: Array<{ key: PermissionCapability; label: string }> = [
  { key: 'geolocation', label: 'Location' },
  { key: 'camera', label: 'Camera' },
  { key: 'microphone', label: 'Microphone' },
];

export function PermissionsSection() {
  const [sites, setSites] = useState<SitePermissions[]>([]);

  useEffect(() => {
    const unsub = window.paperkite.onSitePermissions(setSites);
    window.paperkite.requestSitePermissions();
    return unsub;
  }, []);

  const toggle = (site: SitePermissions, capability: PermissionCapability) => {
    const current = site[capability];
    window.paperkite.setSitePermission({
      origin: site.origin,
      capability,
      decision: current === 'granted' ? 'denied' : 'granted',
    });
  };

  return (
    <section className="settings-section">
      <h2>Site permissions</h2>
      <p className="settings-hint">
        Location, camera, and microphone access remembered per site. A site with no remembered decision is prompted
        the first time it asks.
      </p>

      {sites.length === 0 ? (
        <p className="settings-hint">No sites have been granted or blocked anything yet.</p>
      ) : (
        <ul className="settings-list">
          {sites.map((site) => (
            <li key={site.origin} className="settings-list__row permissions-row">
              <div className="settings-list__main">
                <span className="settings-list__title">{site.origin}</span>
                <span className="permissions-row__capabilities">
                  {CAPABILITIES.filter(({ key }) => site[key]).map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      className={'permissions-pill' + (site[key] === 'granted' ? ' permissions-pill--granted' : '')}
                      onClick={() => toggle(site, key)}
                      title="Click to flip"
                    >
                      {label}: {site[key] === 'granted' ? 'Allowed' : 'Blocked'}
                    </button>
                  ))}
                </span>
              </div>
              <button
                type="button"
                className="settings-list__delete"
                aria-label={`Reset permissions for ${site.origin}`}
                title="Reset - this site will be prompted again"
                onClick={() => window.paperkite.resetSitePermissions(site.origin)}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
