import { useEffect, useRef, useState } from 'react';
import type { AgentConfig, AgentMessage, AgentThread, MessageAttachment } from '../../../shared/types';
import { relativeTime } from '../../../shared/relativeTime';
import { BackIcon, CameraIcon, CloseIcon, RetryIcon, StopIcon, TrashIcon } from '../icons';
import { AgentMarkdown } from './AgentMarkdown';
import { ProviderBadge } from './ProviderBadge';

interface AgentConversationProps {
  thread: AgentThread;
  agent: AgentConfig | null;
  onBack: () => void;
  onDelete: () => void;
  onImageClick: (attachment: MessageAttachment) => void;
}

export function AgentConversation({ thread, agent, onBack, onDelete, onImageClick }: AgentConversationProps) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [workingStatus, setWorkingStatus] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<MessageAttachment | null>(null);
  const [capturing, setCapturing] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  // Lets the single stable subscription below (never torn down on thread
  // switch) discard events for a thread we've since navigated away from -
  // same staleness-guard pattern as ImageLightbox's chain subscription.
  const threadIdRef = useRef(thread.id);
  threadIdRef.current = thread.id;

  useEffect(() => {
    const unsubs = [
      window.paperkiteChat.onAgentMessages((payload) => {
        if (payload.threadId === threadIdRef.current) setMessages(payload.list);
      }),
      window.paperkiteChat.onAgentMessageAdded((payload) => {
        if (payload.threadId !== threadIdRef.current) return;
        setMessages((current) => [...current, payload.message]);
        if (payload.message.role === 'assistant') setStreamingId(payload.message.id);
      }),
      window.paperkiteChat.onAgentMessageChunk((payload) => {
        if (payload.threadId !== threadIdRef.current) return;
        setMessages((current) =>
          current.map((m) => (m.id === payload.messageId ? { ...m, text: m.text + payload.textDelta } : m)),
        );
      }),
      window.paperkiteChat.onAgentMessageStatus((payload) => {
        if (payload.threadId !== threadIdRef.current) return;
        setWorkingStatus(payload.status);
      }),
      window.paperkiteChat.onAgentMessageDone((payload) => {
        if (payload.threadId !== threadIdRef.current) return;
        setStreamingId((current) => (current === payload.messageId ? null : current));
        setWorkingStatus(null);
      }),
      window.paperkiteChat.onAgentMessageError((payload) => {
        if (payload.threadId !== threadIdRef.current) return;
        setStreamingId((current) => (current === payload.messageId ? null : current));
        setWorkingStatus(null);
        setMessages((current) => current.map((m) => (m.id === payload.messageId ? { ...m, error: payload.error } : m)));
      }),
      // Sent right as a retry starts - reset that message's own text/error
      // locally and re-enter "streaming" for it, same as a fresh send's
      // onAgentMessageAdded does for a brand-new placeholder.
      window.paperkiteChat.onAgentMessageRetry((payload) => {
        if (payload.threadId !== threadIdRef.current) return;
        setMessages((current) => current.map((m) => (m.id === payload.messageId ? { ...m, text: '', error: undefined } : m)));
        setStreamingId(payload.messageId);
        setWorkingStatus(null);
      }),
      window.paperkiteChat.onScreenshotCaptured((result) => {
        setCapturing(false);
        if (result) setPendingAttachment(result);
      }),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  useEffect(() => {
    setMessages([]);
    setStreamingId(null);
    setWorkingStatus(null);
    window.paperkiteChat.requestAgentMessages(thread.id);
  }, [thread.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const captureScreenshot = () => {
    if (pendingAttachment || capturing) return;
    setCapturing(true);
    window.paperkiteChat.captureScreenshot();
  };

  const submit = () => {
    const text = value.trim();
    if (!text || streamingId || !agent) return;
    window.paperkiteChat.sendAgentMessage({ threadId: thread.id, text, attachment: pendingAttachment ?? undefined });
    setValue('');
    setPendingAttachment(null);
  };

  return (
    <div className="agent-conversation">
      <div className="agent-conversation__header">
        <button type="button" className="agent-conversation__back" aria-label="Back to threads" onClick={onBack}>
          <BackIcon size={14} />
        </button>
        <div className="agent-conversation__title">
          <span>{thread.title}</span>
          {agent ? (
            <span className="agent-conversation__subtitle">
              <span className="agent-conversation__subtitle-name">{agent.name}</span>
              <ProviderBadge provider={agent.provider} model={agent.model} />
            </span>
          ) : (
            <span className="agent-conversation__subtitle">Agent removed</span>
          )}
        </div>
        <button type="button" className="agent-conversation__delete" aria-label="Delete thread" onClick={onDelete}>
          <TrashIcon size={13} />
        </button>
      </div>

      <div className="message-list">
        {messages.length === 0 && (
          <div className="empty-state">
            <span className="empty-state__kite" aria-hidden>
              ✨
            </span>
            <p>Say something. Use the camera button to attach a screenshot of your current page, if it's relevant.</p>
          </div>
        )}
        {messages.map((message) => {
          const attachment = message.attachment;
          const isStreaming = message.id === streamingId;
          return (
            <div key={message.id} className={'message' + (message.role === 'user' ? ' message--own' : '')}>
              <span className="message__author">{message.role === 'user' ? 'you' : (agent?.name ?? 'agent')}</span>
              <div className="message__bubble">
                {attachment && (
                  <div className="message__attachments">
                    <img
                      className="message__attachment"
                      src={attachment.dataUrl}
                      alt="Screenshot"
                      onClick={() => onImageClick(attachment)}
                    />
                  </div>
                )}
                {message.text &&
                  (message.role === 'assistant' ? (
                    <AgentMarkdown text={message.text} />
                  ) : (
                    <span className="agent-message-text">{message.text}</span>
                  ))}
                {isStreaming &&
                  (workingStatus ? (
                    <span className="agent-working-status">
                      <span className="agent-working-status__dot" aria-hidden />
                      {workingStatus}
                    </span>
                  ) : (
                    <span className="agent-message-cursor" aria-hidden />
                  ))}
                {message.error && (
                  <div className="agent-message-error-row">
                    <p className="agent-message-error">{message.error}</p>
                    <button
                      type="button"
                      className="agent-message-retry"
                      aria-label="Retry this message"
                      onClick={() => window.paperkiteChat.retryAgentMessage({ threadId: thread.id, messageId: message.id })}
                    >
                      <RetryIcon size={11} />
                      Retry
                    </button>
                  </div>
                )}
              </div>
              <span className="message__meta">
                <span className="message__time" title={new Date(message.timestamp).toLocaleString()}>
                  {relativeTime(message.timestamp)}
                </span>
              </span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

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
            disabled={!agent || capturing || !!pendingAttachment}
            onClick={captureScreenshot}
            aria-label="Attach a screenshot of this page"
            title={pendingAttachment ? 'Remove the current screenshot to capture a new one' : 'Attach a screenshot of this page'}
          >
            <CameraIcon />
          </button>
          <textarea
            rows={1}
            value={value}
            placeholder={agent ? `Message ${agent.name}…` : 'This agent was removed'}
            disabled={!agent}
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {streamingId ? (
            <button
              type="button"
              className="message-input__send"
              aria-label="Stop generating"
              onClick={() => window.paperkiteChat.stopAgentMessage(thread.id)}
            >
              <StopIcon size={13} />
            </button>
          ) : (
            <button type="button" className="message-input__send" disabled={!agent || !value.trim()} onClick={submit}>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
