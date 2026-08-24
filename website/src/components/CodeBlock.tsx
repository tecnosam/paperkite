import styles from './CodeBlock.module.css';

export function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <div className={styles.block}>
      {label && <div className={styles.label}>{label}</div>}
      <pre className={styles.pre}>
        <code>{children.trim()}</code>
      </pre>
    </div>
  );
}
