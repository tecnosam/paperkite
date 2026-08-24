interface SetUsernameCtaProps {
  serverName: string;
  onOpenSettings: () => void;
}

/**
 * Replaces MessageInput (rather than sitting alongside a disabled one)
 * whenever the room's effective chat server has no username configured
 * yet - the previous behavior was a disabled textarea with a hint in its
 * placeholder text, easy to miss and not actually clickable. This is the
 * "haven't set one up yet" case; a *rejected* username mid-connect is a
 * different, higher-priority state handled by UsernameTakenModal.
 */
export function SetUsernameCta({ serverName, onOpenSettings }: SetUsernameCtaProps) {
  return (
    <div className="set-username-cta">
      <span className="set-username-cta__text">
        Set a username on <strong>{serverName}</strong> to start chatting
      </span>
      <button type="button" className="set-username-cta__button" onClick={onOpenSettings}>
        Set username
      </button>
    </div>
  );
}
