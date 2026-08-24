import type { SafetySettings, DomainTrustLists } from '../../../shared/types';
import { splitMessageIntoSegments, maskSuspiciousLink } from '../../../shared/linkSafety';
import { maskProfanity, maskFlaggedContent } from '../../../shared/contentFilters';

interface MessageTextProps {
  text: string;
  safety: SafetySettings;
  currentPageHost: string;
  domainTrust: DomainTrustLists;
}

/** Renders message text as plain text plus classified, clickable links -
 * trusted/same-site links open a new tab, suspicious ones are masked,
 * everything else renders as inert plain text. All filtering happens
 * here at render time; the stored message text is never touched. */
export function MessageText({ text, safety, currentPageHost, domainTrust }: MessageTextProps) {
  const segments = splitMessageIntoSegments(text, currentPageHost, domainTrust);

  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === 'text') {
          let value = segment.value;
          if (safety.censorProfanity) value = maskProfanity(value);
          if (safety.censorNudity) value = maskFlaggedContent(value);
          return <span key={i}>{value}</span>;
        }

        // Hyperlink filtering turned off: every link is plain and clickable.
        if (!safety.censorHyperlinks) {
          return <ChatLink key={i} url={segment.url} />;
        }
        if (segment.trust === 'trusted') {
          return <ChatLink key={i} url={segment.url} />;
        }
        if (segment.trust === 'suspicious') {
          return (
            <span key={i} className="message__link message__link--blocked" title="Flagged as spam or phishing">
              ⚠ {maskSuspiciousLink(segment.url)}
            </span>
          );
        }
        return (
          <span key={i} className="message__link message__link--plain">
            {segment.url}
          </span>
        );
      })}
    </>
  );
}

function ChatLink({ url }: { url: string }) {
  const open = () => window.paperkiteChat.openLink(url);
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
      {url}
    </span>
  );
}
