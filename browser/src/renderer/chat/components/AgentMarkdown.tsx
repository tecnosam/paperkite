import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AgentMarkdownProps {
  text: string;
}

/** Renders an assistant reply as markdown (GFM: tables, strikethrough,
 * autolinks) - user-authored text is deliberately left as plain text
 * (see AgentConversation) since interpreting a human's own typing as
 * markdown is more often surprising than helpful. Links are intercepted
 * to open in a new browser tab via IPC rather than navigating this
 * (chatless, non-webContents) view. */
export function AgentMarkdown({ text }: AgentMarkdownProps) {
  return (
    <div className="agent-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

const components: Components = {
  a: ({ href, children }) => {
    const open = () => href && window.paperkiteChat.openLink(href);
    return (
      <span
        className="message__link message__link--trusted"
        role="link"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter') open();
        }}
      >
        {children}
      </span>
    );
  },
};
