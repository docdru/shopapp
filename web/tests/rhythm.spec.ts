import { expect, test } from '@playwright/test';
import { DAY, isDue, purchasesByItem, rhythm } from '../src/lib/rhythm';

// The "usual rhythm" rule from docs/spec.md (Recommendations), without a
// browser: median days between purchases, needs 3 purchase days.

const now = new Date(2026, 10, 3, 12).getTime(); // 3 Nov 2026, noon local time
const daysAgo = (...ds: number[]) => ds.map((d) => now - d * DAY);

test('no rhythm with fewer than 3 purchase days', () => {
  expect(rhythm(daysAgo(8, 4), now)).toBeUndefined();
  // Two purchases on the same day count once.
  expect(rhythm([...daysAgo(8, 4), now - 4 * DAY - 3600_000], now)).toBeUndefined();
});

test('median interval and days since the last purchase', () => {
  // Bought 16, 12, 9 and 5 days ago: gaps 4, 3, 4 → every 4 days.
  const r = rhythm(daysAgo(16, 12, 9, 5), now);
  expect(r).toMatchObject({ every: 4, since: 5, purchases: 4 });
  expect(isDue(r)).toBe(true);
});

test('not due before the usual interval has passed', () => {
  // Every 7 days, last bought 3 days ago.
  expect(isDue(rhythm(daysAgo(17, 10, 3), now))).toBe(false);
});

test('due exactly on the day', () => {
  expect(isDue(rhythm(daysAgo(14, 7), now))).toBe(false); // only 2 purchases
  expect(isDue(rhythm(daysAgo(21, 14, 7), now))).toBe(true);
});

test('no longer suggested when far overdue', () => {
  // Every 2 days, last bought 40 days ago: the family stopped buying it.
  expect(isDue(rhythm(daysAgo(44, 42, 40), now))).toBe(false);
  // Every 30 days, 60 days ago: still within 3 intervals.
  expect(isDue(rhythm(daysAgo(120, 90, 60), now))).toBe(true);
});

test('undo bought cancels the purchase it undoes', () => {
  const byItem = purchasesByItem([
    { item: 'milk', at: now - 9 * DAY },
    { item: 'milk', at: now - 5 * DAY },
    { item: 'bread', at: now - 2 * DAY },
    { item: 'milk', at: now - 1 * DAY },
    { item: 'milk', at: now - 1 * DAY + 60_000, undo: true }
  ]);
  expect(byItem.get('milk')).toEqual(daysAgo(9, 5));
  expect(byItem.get('bread')).toEqual(daysAgo(2));
});
