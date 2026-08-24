import type { DownloadRecord } from '../../../shared/types';
import { relativeTime } from '../../../shared/relativeTime';
import { CloseIcon } from '../icons';

interface DownloadsPanelProps {
  downloads: DownloadRecord[];
  onClose: () => void;
  onCancel: (id: string) => void;
  onOpen: (id: string) => void;
  onShowInFolder: (id: string) => void;
  onClearFinished: () => void;
}

const STATE_LABEL: Record<DownloadRecord['state'], string> = {
  progressing: 'Downloading…',
  completed: 'Done',
  cancelled: 'Cancelled',
  interrupted: 'Failed',
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function DownloadsPanel({ downloads, onClose, onCancel, onOpen, onShowInFolder, onClearFinished }: DownloadsPanelProps) {
  const hasFinished = downloads.some((d) => d.state !== 'progressing');

  return (
    <div className="modal-overlay modal-overlay--top-right" onClick={onClose}>
      <div className="downloads-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-panel__header">
          <h1>Downloads</h1>
          <button type="button" className="settings-panel__close" aria-label="Close downloads" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>

        <div className="downloads-panel__body">
          {downloads.length === 0 ? (
            <p className="settings-hint">No downloads yet.</p>
          ) : (
            <ul className="settings-list">
              {downloads.map((d) => {
                const progress = d.totalBytes > 0 ? Math.min(1, d.receivedBytes / d.totalBytes) : null;
                return (
                  <li key={d.id} className="settings-list__row downloads-panel__row">
                    <div className="settings-list__main">
                      <span className="settings-list__title">{d.filename}</span>
                      <span className="settings-list__url">
                        {d.state === 'progressing'
                          ? `${STATE_LABEL[d.state]} ${formatBytes(d.receivedBytes)}${d.totalBytes > 0 ? ` / ${formatBytes(d.totalBytes)}` : ''}`
                          : `${STATE_LABEL[d.state]} · ${relativeTime(d.startTime)}`}
                      </span>
                      {d.state === 'progressing' && (
                        <span className="downloads-panel__bar">
                          <span
                            className="downloads-panel__bar-fill"
                            style={{ width: progress !== null ? `${progress * 100}%` : '35%' }}
                          />
                        </span>
                      )}
                    </div>
                    {d.state === 'progressing' && (
                      <button type="button" className="downloads-panel__action" onClick={() => onCancel(d.id)}>
                        Cancel
                      </button>
                    )}
                    {d.state === 'completed' && (
                      <>
                        <button type="button" className="downloads-panel__action" onClick={() => onOpen(d.id)}>
                          Open
                        </button>
                        <button type="button" className="downloads-panel__action" onClick={() => onShowInFolder(d.id)}>
                          Show
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {hasFinished && (
            <button type="button" className="settings-clear__start downloads-panel__clear" onClick={onClearFinished}>
              Clear finished
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
