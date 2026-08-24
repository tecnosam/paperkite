import { ChatBubbleIcon } from '@/components/icons';
import styles from './BrowserMock.module.css';

const messages = [
  { flag: '🇯🇵', name: 'yuki', text: 'anyone here from a team that tried this', own: false },
  { flag: '🇧🇷', name: 'mariana', text: 'we switched in january, mixed results so far', own: false },
  { flag: '🇩🇪', name: 'lena', text: 'the numbers in section 3 match what I have seen', own: false },
  { flag: '🇳🇬', name: 'you', text: 'same page, three different countries', own: true },
];

export function BrowserMock() {
  return (
    <div className={styles.window} role="img" aria-label="Paperkite browser window showing a live chat panel next to a webpage">
      <div className={styles.titlebar}>
        <div className={styles.dots}>
          <span /><span /><span />
        </div>
        <div className={styles.tabs}>
          <div className={`${styles.tab} ${styles.tabActive}`}>the four-day week, one year in</div>
          <div className={styles.tab}>+</div>
        </div>
      </div>

      <div className={styles.addressRow}>
        <span className={styles.lock}>🔒</span>
        <span className={styles.url}>fieldnotes.example/four-day-week-one-year-in</span>
        <div className={styles.presence}>
          <span className={styles.presenceDot} />
          4 here now
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.page}>
          <div className={styles.pageBar} style={{ width: '58%' }} />
          <div className={styles.pageBar} style={{ width: '82%' }} />
          <div className={styles.pageBar} style={{ width: '40%' }} />
          <div className={styles.pageImg} />
          <div className={styles.pageBar} style={{ width: '70%' }} />
          <div className={styles.pageBar} style={{ width: '52%' }} />
        </div>

        <div className={styles.chat}>
          <div className={styles.chatHeader}>
            <ChatBubbleIcon size={13} />
            <span>Page chat</span>
          </div>

          <div className={styles.messages}>
            {messages.map((m, i) => (
              <div
                key={i}
                className={`${styles.message} ${m.own ? styles.messageOwn : ''}`}
                style={{ animationDelay: `${400 + i * 260}ms` }}
              >
                <span className={styles.author}>
                  <span>{m.flag}</span>
                  {m.name}
                </span>
                <span className={styles.bubble}>{m.text}</span>
              </div>
            ))}
            <div className={styles.typing} style={{ animationDelay: `${400 + messages.length * 260}ms` }}>
              <span className={styles.typingDot} />
              someone is typing
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
