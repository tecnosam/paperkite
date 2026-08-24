import { SparkleIcon } from '@/components/icons';
import styles from './AgentsSection.module.css';

const providers = [
  { name: 'Claude', dot: '#c44a3a', note: 'Anthropic' },
  { name: 'GPT', dot: '#3d6d94', note: 'OpenAI' },
  { name: 'Gemini', dot: '#7cabd4', note: 'Google' },
  { name: 'Ollama', dot: '#a89d89', note: 'any local model' },
];

export function AgentsSection() {
  return (
    <section id="agents" className={styles.section}>
      <div className={`shell ${styles.grid}`}>
        <div className={styles.copy}>
          <span className="eyebrow">
            <SparkleIcon size={13} />
            AI agents, in the room
          </span>
          <h2 className={styles.title}>Chat with an agent about the page you&apos;re on.</h2>
          <p className={styles.body}>
            Open the agent panel next to any tab and ask about what&apos;s in front of you.
            Paperkite ships adapters for the major hosted providers and for open-source models
            through Ollama. Pick a provider per conversation, keep your keys local, and switch
            anytime.
          </p>

          <div className={styles.providers}>
            {providers.map((p) => (
              <span className={styles.chip} key={p.name}>
                <span className={styles.dot} style={{ background: p.dot }} />
                {p.name}
                <span className={styles.note}>{p.note}</span>
              </span>
            ))}
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <SparkleIcon size={13} />
            <span>Agent · Claude</span>
          </div>
          <div className={styles.thread}>
            <div className={styles.bubbleUser}>summarize the top comment thread on this page</div>
            <div className={styles.bubbleAgent}>
              Most replies point to the same finding: teams cut meeting time in half but
              individual output held steady. One thread links the internal report the study
              is based on.
              <span className={styles.cursor} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
