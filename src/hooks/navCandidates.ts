/**
 * What counts as a D-pad stop.
 *
 * A remote's OK button activates whatever has DOM focus, so "navigable" is
 * really "focusable, and deliberately exposed to the arrow keys". Both the
 * D-pad hook and the per-route focus landing need the same answer, so it is
 * defined once here: two subtly different lists would mean a control that the
 * hook can navigate to but the route focus refuses to land on, or worse, the
 * reverse.
 */
import { focusableSelector } from './focusableSelector';

function isVisible(element: HTMLElement): boolean {
  // offsetParent is null for `display:none` subtrees. Cheaper than getBoundingClientRect.
  return element.offsetParent !== null || element === document.activeElement;
}

/**
 * Is this element a legal D-pad stop?
 *
 * `data-nav` opts an element *in*, so every exclusion has to be explicit:
 *
 *  - `data-nav="false"` opts back out. React renders a boolean `data-*` value as
 *    the string `"false"`, so the attribute is present and a bare
 *    `hasAttribute` test cannot tell the two apart. The row paging arrows and
 *    the card favourite button use this to keep pointer-only affordances off
 *    the remote.
 *  - `tabindex="-1"` takes an element out of the sequential focus order on
 *    purpose. `Hero`'s poster link is one: a pointer affordance that a remote
 *    user reaches instead through the rows below it.
 *  - Anything inside `aria-hidden` is not a focus stop, because focusing it
 *    would move the D-pad to something assistive tech is hiding deliberately.
 */
export function isNavCandidate(element: HTMLElement): boolean {
  if (!element.hasAttribute('data-nav')) return false;
  if (element.getAttribute('data-nav') === 'false') return false;
  if (element.getAttribute('tabindex') === '-1') return false;
  if (element.closest('[aria-hidden="true"]')) return false;
  return isVisible(element);
}

/**
 * Every navigable element inside `root`, in document order.
 *
 * Only mounted, visible elements are returned, which is what keeps a
 * virtualised 5000-item grid costing the same as a 20-item row.
 */
export function navCandidates(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(isNavCandidate);
}
