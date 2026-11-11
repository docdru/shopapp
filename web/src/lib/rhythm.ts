// "Usually bought now" (spec: Recommendations → Usual rhythm). Pure functions
// over purchase dates, so they can be tested without a browser or database.

export const DAY = 24 * 60 * 60 * 1000;

/** Fewer purchases than this: no rhythm yet. */
export const MIN_PURCHASES = 3;

/** Past this many intervals overdue, the item probably isn't bought any more. */
export const STALE_FACTOR = 3;

export interface Rhythm {
  /** Median days between purchases. */
  every: number;
  /** Days since the last purchase. */
  since: number;
  /** since / every: 1 = due today, 2 = one interval overdue. */
  due: number;
  purchases: number;
}

/** Local calendar day number (several purchases on one day count once). */
function dayNumber(t: number): number {
  const d = new Date(t);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The buying rhythm of one item from its purchase times (ms, any order):
 * the median number of days between purchase days. Undefined with fewer than
 * MIN_PURCHASES purchase days.
 */
export function rhythm(times: number[], now: number): Rhythm | undefined {
  const days = [...new Set(times.map(dayNumber))].sort((a, b) => a - b);
  if (days.length < MIN_PURCHASES) return undefined;
  const gaps = days.slice(1).map((d, i) => d - days[i]);
  const every = median(gaps);
  const since = dayNumber(now) - days[days.length - 1];
  return { every, since, due: since / every, purchases: days.length };
}

/**
 * Is the item due? Due once the time since the last purchase reaches its
 * usual interval; no longer suggested once it is STALE_FACTOR intervals
 * overdue (and at least 30 days), when the family has likely stopped buying it.
 */
export function isDue(r: Rhythm | undefined): r is Rhythm {
  if (!r || r.every <= 0) return false;
  return r.since >= r.every && r.since <= Math.max(STALE_FACTOR * r.every, r.every + 30);
}

export interface Purchase {
  item: string;
  /** ms since epoch */
  at: number;
  /** true for an "undo bought": cancels that item's latest purchase before it */
  undo?: boolean;
}

/** Purchase times per item, with undone purchases removed. */
export function purchasesByItem(events: Purchase[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    const list = out.get(e.item) ?? [];
    if (e.undo) list.pop();
    else list.push(e.at);
    out.set(e.item, list);
  }
  return out;
}
