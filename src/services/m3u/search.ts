/** Precomputed, lowercase search haystacks. Built once at parse time. */
import { normalizeLanguage } from './categorize';

const SEP = ' ';

/**
 * One lowercase string per item, containing everything worth matching:
 * title, group, provider names, ids, language and country.
 *
 * Built during parsing (in the worker) so that typing in the search box never
 * pays a `toLowerCase()` cost per keystroke.
 */
export function buildSearchBlob(
  name: string,
  group: string,
  tvgName: string,
  tvgId: string,
  language: string,
  country: string,
): string {
  const parts: string[] = [name];
  if (group) parts.push(group);
  if (tvgName && tvgName !== name) parts.push(tvgName);
  if (tvgId) parts.push(tvgId);
  const lang = normalizeLanguage(language);
  if (lang) parts.push(lang);
  if (country) parts.push(country);
  return parts.join(SEP).toLowerCase();
}
