import { useEffect, useRef, useState } from 'react';
import { CloseIcon, ChevronUpIcon, ChevronDownIcon } from '../icons';

interface FindBarProps {
  result: { activeMatchOrdinal: number; matches: number } | null;
  onSearch: (text: string, forward: boolean, findNext: boolean) => void;
  onClose: () => void;
}

/** Rendered inside the strip WindowManager reserves below the toolbar
 * (see main/layout.ts's FIND_BAR_HEIGHT) whenever main opens it - the
 * three layered native views here mean this can't just float over the
 * page as a CSS overlay. */
export function FindBar({ result, onSearch, onClose }: FindBarProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const search = (forward: boolean, findNext: boolean) => {
    if (text) onSearch(text, forward, findNext);
  };

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        value={text}
        spellCheck={false}
        placeholder="Find in page"
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          onSearch(value, true, false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') search(!e.shiftKey, true);
          if (e.key === 'Escape') onClose();
        }}
      />
      {result && text && (
        <span className="find-bar__count">
          {result.matches === 0 ? '0/0' : `${result.activeMatchOrdinal}/${result.matches}`}
        </span>
      )}
      <button type="button" aria-label="Previous match" disabled={!text} onClick={() => search(false, true)}>
        <ChevronUpIcon />
      </button>
      <button type="button" aria-label="Next match" disabled={!text} onClick={() => search(true, true)}>
        <ChevronDownIcon />
      </button>
      <button type="button" aria-label="Close find bar" onClick={onClose}>
        <CloseIcon size={11} />
      </button>
    </div>
  );
}
