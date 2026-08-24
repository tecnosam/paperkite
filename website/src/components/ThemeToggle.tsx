'use client';

import { useSyncExternalStore } from 'react';
import { MoonIcon, SunIcon } from '@/components/icons';
import styles from './ThemeToggle.module.css';

const CHANGE_EVENT = 'paperkite-theme-change';

function getSnapshot(): 'light' | 'dark' {
  const stored = localStorage.getItem('paperkite-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getServerSnapshot(): 'light' | 'dark' | null {
  return null;
}

function subscribe(callback: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  window.addEventListener('storage', callback);
  window.addEventListener(CHANGE_EVENT, callback);
  mq.addEventListener('change', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(CHANGE_EVENT, callback);
    mq.removeEventListener('change', callback);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next = getSnapshot() === 'dark' ? 'light' : 'dark';
    localStorage.setItem('paperkite-theme', next);
    document.documentElement.setAttribute('data-theme', next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={toggle}
      aria-label="Toggle color theme"
      title="Toggle color theme"
    >
      {theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
    </button>
  );
}
