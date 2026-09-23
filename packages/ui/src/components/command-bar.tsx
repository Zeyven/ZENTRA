'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { MagnifyingGlass, ArrowRight } from '@phosphor-icons/react';
export function CommandBar({
  items,
  onSelect,
}: {
  items: readonly string[];
  onSelect: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const matches = items.filter((i) => i.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const select = (value: string) => {
    onSelect(value);
    setQuery('');
    setActive(0);
  };
  return (
    <div className="global-search">
      <MagnifyingGlass size={19} />
      <input
        ref={input}
        role="combobox"
        aria-label="搜索页面"
        aria-autocomplete="list"
        aria-expanded={Boolean(query)}
        aria-controls={query ? id : undefined}
        aria-activedescendant={query && matches.length ? `${id}-${active}` : undefined}
        placeholder="Search your workspace…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setQuery('');
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          }
          if (e.key === 'Enter' && matches[active]) {
            e.preventDefault();
            select(matches[active]);
          }
        }}
      />
      <kbd>⌘ K</kbd>
      {query && (
        <div className="search-results" id={id} role="listbox">
          {matches.map((i, index) => (
            <button
              type="button"
              role="option"
              id={`${id}-${index}`}
              key={i}
              aria-selected={active === index}
              onClick={() => select(i)}
            >
              {i}
              <ArrowRight size={14} />
            </button>
          ))}
          {!matches.length && <p role="status">No matching pages</p>}
        </div>
      )}
    </div>
  );
}
