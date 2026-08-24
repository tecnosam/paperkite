import { useState } from 'react';
import type { PermissionCapability, PermissionRequestPayload } from '../../../shared/types';

interface PermissionPromptProps {
  request: PermissionRequestPayload;
  onRespond: (allow: boolean, remember: boolean) => void;
}

const CAPABILITY_LABEL: Record<PermissionCapability, string> = {
  geolocation: 'know your location',
  camera: 'use your camera',
  microphone: 'use your microphone',
};

function describe(capabilities: PermissionCapability[]): string {
  if (capabilities.length === 2 && capabilities.includes('camera') && capabilities.includes('microphone')) {
    return 'use your camera and microphone';
  }
  return capabilities.map((c) => CAPABILITY_LABEL[c]).join(' and ');
}

/** A dismiss (backdrop click) is treated the same as Block, not
 * remembered - the safe default, and the only way to actually resolve
 * the page's pending request instead of leaving it hanging forever. */
export function PermissionPrompt({ request, onRespond }: PermissionPromptProps) {
  const [remember, setRemember] = useState(true);

  return (
    <div className="modal-overlay modal-overlay--top" onClick={() => onRespond(false, false)}>
      <div className="permission-prompt" onClick={(e) => e.stopPropagation()}>
        <p className="permission-prompt__text">
          <strong>{request.origin}</strong> wants to {describe(request.capabilities)}
        </p>
        <label className="permission-prompt__remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember this choice
        </label>
        <div className="permission-prompt__actions">
          <button type="button" className="permission-prompt__block" onClick={() => onRespond(false, remember)}>
            Block
          </button>
          <button type="button" className="permission-prompt__allow" onClick={() => onRespond(true, remember)}>
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
