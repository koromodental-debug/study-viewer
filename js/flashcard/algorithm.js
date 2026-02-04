// Flashcard spaced repetition algorithm utilities.
// Extracted from js/flashcard.js (no runtime wiring yet).

export const INTERVAL_SCHEDULE = [1, 3, 7, 14, 30, 60, 90];
export const DAY_MS = 24 * 60 * 60 * 1000;

export function getNextInterval(currentInterval) {
  const idx = INTERVAL_SCHEDULE.indexOf(currentInterval);
  if (idx === -1) {
    // If current interval isn't in the schedule, pick the next higher step.
    for (let i = 0; i < INTERVAL_SCHEDULE.length; i++) {
      if (INTERVAL_SCHEDULE[i] > currentInterval) {
        return INTERVAL_SCHEDULE[i];
      }
    }
    // If already beyond 90 days, increase by 1.5x up to 180 days.
    return Math.min(180, Math.round(currentInterval * 1.5));
  }
  if (idx < INTERVAL_SCHEDULE.length - 1) {
    return INTERVAL_SCHEDULE[idx + 1];
  }
  // Max interval reached: increase by 1.5x up to 180 days.
  return Math.min(180, Math.round(currentInterval * 1.5));
}
