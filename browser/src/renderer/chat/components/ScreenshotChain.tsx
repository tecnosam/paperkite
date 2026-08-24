import type { ScreenshotChainNode } from '../../../shared/types';
import { ArrowRightIcon } from '../icons';

interface ScreenshotChainProps {
  nodes: ScreenshotChainNode[];
  currentId: string;
  onSelect: (node: ScreenshotChainNode) => void;
}

/**
 * A compact "you are here" strip: the small window of screenshots
 * (across every room) captured immediately before/after the one being
 * viewed, connected by arrows (oldest to newest, left to right) labeled
 * with how many distinct pages were visited in between.
 */
export function ScreenshotChain({ nodes, currentId, onSelect }: ScreenshotChainProps) {
  if (nodes.length < 2) return null;

  return (
    <div className="chain">
      {nodes.map((node, i) => (
        <div className="chain__item" key={node.id}>
          {i > 0 && (
            <div className="chain__link">
              <ArrowRightIcon size={13} />
              {node.pagesSincePrevious !== null && (
                <span className="chain__gap">
                  {node.pagesSincePrevious} {node.pagesSincePrevious === 1 ? 'page' : 'pages'}
                </span>
              )}
            </div>
          )}
          <button
            type="button"
            className={'chain__node' + (node.id === currentId ? ' chain__node--current' : '')}
            onClick={() => onSelect(node)}
            title={node.url}
          >
            <img src={node.dataUrl} alt="" />
          </button>
        </div>
      ))}
    </div>
  );
}
