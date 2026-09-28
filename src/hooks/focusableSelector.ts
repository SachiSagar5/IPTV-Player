/**
 * The selector used to enumerate navigable elements.
 *
 * Kept in its own module so both the D-pad hook and the "focus the first card on
 * route change" helper agree on what counts as navigable, and so the list is
 * easy to audit: anything a remote's OK button can activate must be here.
 */
export const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');
