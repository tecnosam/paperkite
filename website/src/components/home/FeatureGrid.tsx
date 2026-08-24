import { CheckIcon, GlobeIcon, LockOpenIcon, MicIcon, PlugIcon, ServerIcon } from '@/components/icons';
import styles from './FeatureGrid.module.css';

const features = [
  {
    icon: PlugIcon,
    title: 'Bring your own MCP servers',
    body: 'Add any Model Context Protocol server to the browser. Your agents can call its tools while browsing: file systems, search, internal APIs, whatever you point them at.',
  },
  {
    icon: ServerIcon,
    title: 'Ships with its own MCP server',
    body: "Paperkite exposes the page you're on, its content, the room, and the chat, as MCP tools of its own. External agents can act on what you're browsing instead of only discussing it.",
  },
  {
    icon: MicIcon,
    title: 'Live audio translation',
    body: 'Whisper-powered live translation for audio on the page: calls, videos, streams. Swap in your own custom models if you want.',
  },
  {
    icon: GlobeIcon,
    title: 'Whole-page translation',
    body: "Translate the page you're reading with open-source or commercial models, whichever you prefer. No lock-in to one vendor's quality or pricing.",
  },
  {
    icon: LockOpenIcon,
    title: 'Fully open source',
    body: 'Browser, chat protocol, and server are all MIT licensed. Read the wire format, run your own fork, audit every byte that leaves the app.',
  },
];

export function FeatureGrid() {
  return (
    <section id="features" className={styles.section}>
      <div className="shell">
        <div className={styles.head}>
          <span className="eyebrow">What&apos;s in the box</span>
          <h2 className={styles.title}>What Paperkite ships with.</h2>
        </div>

        <div className={styles.grid}>
          {features.map((f, i) => (
            <div className={styles.card} key={f.title} style={{ animationDelay: `${i * 60}ms` }}>
              <div className={styles.iconWrap}>
                <f.icon size={18} />
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}

          <div className={`${styles.card} ${styles.cardMuted}`}>
            <div className={styles.checklist}>
              {['No walled garden', 'No forced accounts', 'No telemetry by default', 'Self-hostable end to end'].map((t) => (
                <span key={t}>
                  <CheckIcon size={13} />
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
