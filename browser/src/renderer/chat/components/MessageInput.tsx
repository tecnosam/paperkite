import { useEffect, useState } from 'react';
import type { MessageAttachment } from '../../../shared/types';
import { encodeChatImageMessage } from '../../../shared/chatImageAttachment';
import { CameraIcon, CloseIcon } from '../icons';

interface MessageInputProps {
  disabled: boolean;
  /** Caller computes this from *why* it's disabled (no username vs. still
   * connecting vs. an actual connection error vs. nothing to connect to at
   * all) - see App.tsx's inputPlaceholderFor. Also used as the send-ready
   * placeholder when not disabled. */
  placeholder: string;
  /** Already-encoded wire content - a plain string for ordinary text, or
   * one flagged per shared/chatImageAttachment.ts when a screenshot's
   * attached (encoding happens here, not in the caller). */
  onSend: (content: string) => void;
}

export function MessageInput({ disabled, placeholder, onSend }: MessageInputProps) {
  const [value, setValue] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<MessageAttachment | null>(null);
  const [capturing, setCapturing] = useState(false);

  useEffect(
    () =>
      window.paperkiteChat.onScreenshotCaptured((result) => {
        setCapturing(false);
        if (result) setPendingAttachment(result);
      }),
    [],
  );

  const captureScreenshot = () => {
    if (pendingAttachment || capturing) return;
    setCapturing(true);
    window.paperkiteChat.captureScreenshot();
  };

  const submit = () => {
    const text = value.trim();
    if (!text && !pendingAttachment) return;
    const content = pendingAttachment ? encodeChatImageMessage({ dataUrl: pendingAttachment.dataUrl, text }) : text;
    onSend(content);
    setValue('');
    setPendingAttachment(null);
  };

  return (
    <div className="message-input">
      {pendingAttachment && (
        <div className="message-input__preview">
          <div className="message-input__preview-item">
            <img src={pendingAttachment.dataUrl} alt="Screenshot preview" />
            <button
              type="button"
              className="message-input__preview-remove"
              aria-label="Remove screenshot"
              onClick={() => setPendingAttachment(null)}
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      )}
      <div className="message-input__row">
        <button
          type="button"
          className={'message-input__camera' + (capturing ? ' message-input__camera--busy' : '')}
          disabled={disabled || capturing || !!pendingAttachment}
          onClick={captureScreenshot}
          aria-label="Attach a screenshot of this page"
          title={pendingAttachment ? 'Remove the current screenshot to capture a new one' : 'Attach a screenshot of this page'}
        >
          <CameraIcon />
        </button>
        <textarea
          rows={1}
          value={value}
          placeholder={pendingAttachment ? 'Add a caption…' : placeholder}
          disabled={disabled}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" className="message-input__send" disabled={disabled || (!value.trim() && !pendingAttachment)} onClick={submit}>
          Send
        </button>
      </div>
    </div>
  );
}
