/**
 * The selector used to enumerate navigable elements.
 *
 * Kept in its own module so `navCandidates` — the shared answer to "what can a
 * remote reach", used by both the D-pad hook and the per-route focus landing —
 * and the D-pad hook itself cannot drift apart, and so the list is easy to
 * audit: anything a remote's OK button can activate must be here.
 */
export const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');
