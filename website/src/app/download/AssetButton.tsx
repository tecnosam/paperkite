import { DownloadIcon } from '@/components/icons';
import { formatBytes, type BrowserAsset } from '@/lib/releases';
import styles from './AssetButton.module.css';

// One downloadable file, rendered as a button - reused by every
// architecture/format combination on both the Windows and Linux
// download pages so the visual language (and the size/hint layout)
// stays identical across the two.
export function AssetButton({
  asset,
  label,
  hint,
  primary = false,
}: {
  asset: BrowserAsset;
  label: string;
  hint: string;
  primary?: boolean;
}) {
  return (
    <a href={asset.url} className={`${styles.asset} ${primary ? styles.primary : ''}`}>
      <span className={styles.iconWrap}>
        <DownloadIcon size={15} />
      </span>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        <span className={`mono ${styles.hint}`}>{hint}</span>
      </span>
      <span className={`mono ${styles.size}`}>{formatBytes(asset.size)}</span>
    </a>
  );
}
