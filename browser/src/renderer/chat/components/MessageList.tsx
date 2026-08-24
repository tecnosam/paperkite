import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, SafetySettings, DomainTrustLists, MessageAttachment } from '../../../shared/types';
import { flagEmoji } from '../../../shared/flagEmoji';
import { relativeTime } from '../../../shared/relativeTime';
import { decodeChatImageMessage } from '../../../shared/chatImageAttachment';
import { MessageText } from './MessageText';
import { PinIcon } from '../icons';

interface MessageListProps {
  messages: ChatMessage[];
  username: string | null;
  safety: SafetySettings;
  currentPageHost: string;
  /** The room's actual URL - used only to fill in a synthesized
   * MessageAttachment for the lightbox (see onImageClick) when a message
   * turns out to carry an embedded screenshot. */
  url: string;
  domainTrust: DomainTrustLists;
  pinnedIds: Set<string>;
  onTogglePin: (id: string) => void;
  onImageClick: (attachment: MessageAttachment) => void;
}

export function MessageList({
  messages,
  username,
  safety,
  currentPageHost,
  url,
  domainTrust,
  pinnedIds,
  onTogglePin,
  onImageClick,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  // Relative labels ("2m ago") go stale while the panel sits open; a slow
  // tick keeps them honest without re-fetching anything.
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-state__kite" aria-hidden>
          🪁
        </span>
        <p>Be the first to post on this page.</p>
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((message) => {
        const isOwn = message.username === username;
        const pinned = pinnedIds.has(message.id);
        // Screenshots ride inside the message's own `text` (see
        // shared/chatImageAttachment.ts's doc comment for why - the
        // chat-service wire format is one plain string, nothing more) -
        // decode it back out here rather than treating it as literal text.
        const image = decodeChatImageMessage(message.text);
        const caption = image ? image.text : message.text;
        return (
          <div key={message.id} className={'message' + (isOwn ? ' message--own' : '') + (pinned ? ' message--pinned' : '')}>
            <span className="message__author">
              {isOwn ? 'you' : message.username}
              {message.countryCode && (
                <span className="message__flag" aria-hidden>
                  {flagEmoji(message.countryCode)}
                </span>
              )}
            </span>
            <div className="message__bubble">
              {image && (
                <div className="message__attachments">
                  <img
                    className="message__attachment"
                    src={image.dataUrl}
                    alt="Screenshot"
                    onClick={() =>
                      onImageClick({
                        kind: 'screenshot',
                        id: message.id,
                        dataUrl: image.dataUrl,
                        width: 0,
                        height: 0,
                        url,
                        timestamp: message.timestamp,
                      })
                    }
                  />
                </div>
              )}
              {caption && <MessageText text={caption} safety={safety} currentPageHost={currentPageHost} domainTrust={domainTrust} />}
            </div>
            <span className="message__meta">
              <button
                type="button"
                className={'message__pin' + (pinned ? ' message__pin--active' : '')}
                aria-label={pinned ? 'Unpin message' : 'Pin message'}
                aria-pressed={pinned}
                title={pinned ? 'Pinned - for this session, this room' : 'Pin message'}
                onClick={() => onTogglePin(message.id)}
              >
                <PinIcon filled={pinned} />
              </button>
              <span className="message__time" title={new Date(message.timestamp).toLocaleString()}>
                {relativeTime(message.timestamp)}
              </span>
            </span>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
