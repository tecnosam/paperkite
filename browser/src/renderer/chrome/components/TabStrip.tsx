import type { TabInfo } from '../../../shared/types';
import { PlusIcon, CloseIcon, GlobeIcon } from '../icons';

interface TabStripProps {
  tabs: TabInfo[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
}

export function TabStrip({ tabs, activeId, onSwitch, onClose, onNewTab }: TabStripProps) {
  return (
    <div className="tab-strip">
      <div className="tab-strip__scroller">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={'tab' + (tab.id === activeId ? ' tab--active' : '')}
            onClick={() => onSwitch(tab.id)}
            title={tab.title || tab.url}
          >
            <span className="tab__icon">
              {tab.loading ? (
                <span className="spinner" />
              ) : tab.favicon ? (
                <img src={tab.favicon} alt="" width={13} height={13} />
              ) : (
                <GlobeIcon />
              )}
            </span>
            <span className="tab__title">{tab.title || 'New Tab'}</span>
            <button
              type="button"
              className="tab__close"
              aria-label="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="tab-strip__new" aria-label="New tab" onClick={onNewTab}>
        <PlusIcon />
      </button>
    </div>
  );
}
