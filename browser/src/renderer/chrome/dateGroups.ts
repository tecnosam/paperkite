import type { HistoryEntry } from '../../shared/types';

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  if (isSameDay(date, now)) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';

  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { weekday: 'long', month: 'long', day: 'numeric' }
      : { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
  return date.toLocaleDateString(undefined, options);
}

export interface DateGroup {
  label: string;
  entries: HistoryEntry[];
}

/** Buckets already-sorted (newest first) history entries under calendar-day
 * headers, the way Chrome's history page does - "Today", "Yesterday", then
 * a full weekday/date. Assumes entries arrive newest-first, which is what
 * historyStore.getHistoryPage() returns, so consecutive same-day entries
 * are always adjacent and this can be a single linear pass. */
export function groupByDate(entries: HistoryEntry[]): DateGroup[] {
  const groups: DateGroup[] = [];

  for (const entry of entries) {
    const label = dayLabel(entry.timestamp);
    const current = groups[groups.length - 1];
    if (current && current.label === label) {
      current.entries.push(entry);
    } else {
      groups.push({ label, entries: [entry] });
    }
  }

  return groups;
}
