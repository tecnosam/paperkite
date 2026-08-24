import styles from './HowItWorks.module.css';

const steps = [
  {
    n: '01',
    title: 'Open any page',
    body: 'No setup. Paperkite hashes the URL into a room the instant a tab loads it.',
  },
  {
    n: '02',
    title: 'Land in its room',
    body: 'Everyone else currently on that same URL, anywhere, on any connection, is already there.',
  },
  {
    n: '03',
    title: 'Talk, or loop in an agent',
    body: 'Chat with the room, or hand the page to Claude, GPT, Gemini, or a local Ollama model.',
  },
];

export function HowItWorks() {
  return (
    <section className={styles.section}>
      <div className={`shell ${styles.shell}`}>
        {steps.map((s, i) => (
          <div className={styles.step} key={s.n}>
            <span className={styles.n}>{s.n}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            {i < steps.length - 1 && <span className={styles.connector} aria-hidden />}
          </div>
        ))}
      </div>
    </section>
  );
}
