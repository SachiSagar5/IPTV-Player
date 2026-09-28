/**
 * Search index — built **inside the parse worker** and handed to the main
 * thread as transferable ArrayBuffers, so the index costs the main thread
 * essentially nothing.
 *
 * Requirements this satisfies:
 *  - Typing must never rescan the playlist (real inverted index, not `filter`).
 *  - The index must be available the instant a playlist finishes parsing.
 *  - Building it must not produce a long task on the UI thread.
 *
 * Wire format is CSR (compressed sparse row):
 *   tokenBlob        all unique tokens concatenated, sorted, '\0'-delimited
 *   tokenOffsets     Int32Array(n+1) boundaries into tokenBlob
 *   postingsOffsets  Int32Array(n+1) boundaries into postings
 *   postings         Int32Array(total) ascending item indices per token
 *
 * A query token is prefix-expanded with a binary search over the sorted token
 * range; multi-word queries intersect the resulting posting lists.
 */
import type { ContentItem } from '@/types';

const MIN_TOKEN_LENGTH = 2;
const SEPARATOR = '\u0000';
/** Hard cap so a broad query cannot produce tens of thousands of rows. */
export const MAX_RESULTS = 300;

/**
 * Charcode separator test. A per-character regex was the hottest loop during
 * profiling, so this is a branch on the code unit instead.
 */
function isSeparatorCode(c: number): boolean {
  // 0..47  -> control chars, space, and !"#$%&'()*+,-./
  if (c <= 47) return true;
  // 48..57 digits, 65..90 upper, 97..122 lower, 128+ non-latin letters
  if (c === 58 || c === 59) return true; // : ;
  if (c === 91 || c === 92 || c === 93) return true; // [ \ ]
  if (c === 95) return true; // _
  if (c === 123 || c === 124 || c === 125 || c === 126) return true; // { | } ~
  return false;
}

export interface CompactSearchIndex {
  tokenBlob: string;
  tokenOffsets: Int32Array;
  postingsOffsets: Int32Array;
  postings: Int32Array;
  itemCount: number;
}

export interface SearchHit {
  item: ContentItem;
  index: number;
  score: number;
}

function tokenize(blob: string, out: string[]): void {
  const len = blob.length;
  let start = -1;
  for (let i = 0; i <= len; i++) {
    const c = i < len ? blob.charCodeAt(i) : 32;
    if (isSeparatorCode(c)) {
      if (start !== -1 && i - start >= MIN_TOKEN_LENGTH) out.push(blob.slice(start, i));
      start = -1;
    } else if (start === -1) {
      start = i;
    }
  }
}

/** Worker-side build. Returns plain buffers that can be transferred. */
export function buildCompactSearchIndex(items: readonly ContentItem[]): CompactSearchIndex {
  const map = new Map<string, number[]>();
  const scratch: string[] = [];

  for (let i = 0; i < items.length; i++) {
    scratch.length = 0;
    tokenize(items[i].search, scratch);
    for (let t = 0; t < scratch.length; t++) {
      const token = scratch[t];
      let list = map.get(token);
      if (list === undefined) {
        list = [];
        map.set(token, list);
      }
      list.push(i);
    }
  }

  const tokens = Array.from(map.keys());
  tokens.sort();

  const tokenOffsets = new Int32Array(tokens.length + 1);
  const postingsOffsets = new Int32Array(tokens.length + 1);
  let totalPostings = 0;
  for (let i = 0; i < tokens.length; i++) {
    totalPostings += map.get(tokens[i])!.length;
  }
  const postings = new Int32Array(totalPostings);
  const blob = new Array<string>(tokens.length);

  let blobLength = 0;
  let cursor = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    tokenOffsets[i] = blobLength;
    blob[i] = token;
    blobLength += token.length + 1; // +1 for the '\0' separator

    postingsOffsets[i] = cursor;
    const list = map.get(token)!;
    for (let j = 0; j < list.length; j++) postings[cursor + j] = list[j];
    cursor += list.length;
  }
  tokenOffsets[tokens.length] = blobLength;
  postingsOffsets[tokens.length] = cursor;

  return {
    tokenBlob: blob.join(SEPARATOR),
    tokenOffsets,
    postingsOffsets,
    postings,
    itemCount: items.length,
  };
}

function toNumberArray(value: Int32Array | number[]): Int32Array {
  return value instanceof Int32Array ? value : Int32Array.from(value);
}

export class SearchIndex {
  readonly size: number;
  private readonly tokenBlob: string;
  private readonly tokenOffsets: Int32Array;
  private readonly postingsOffsets: Int32Array;
  private readonly postings: Int32Array;
  private readonly tokenCount: number;
  private readonly items: readonly ContentItem[];

  constructor(compact: CompactSearchIndex, items: readonly ContentItem[]) {
    this.tokenBlob = compact.tokenBlob;
    this.tokenOffsets = toNumberArray(compact.tokenOffsets);
    this.postingsOffsets = toNumberArray(compact.postingsOffsets);
    this.postings = toNumberArray(compact.postings);
    this.tokenCount = this.tokenOffsets.length - 1;
    this.items = items;
    this.size = compact.itemCount;
  }

  private tokenAt(i: number): string {
    return this.tokenBlob.slice(this.tokenOffsets[i], this.tokenOffsets[i + 1]);
  }

  /** First token index whose value is >= `target`. */
  private lowerBound(target: string): number {
    let lo = 0;
    let hi = this.tokenCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.tokenAt(mid) < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private postingsOf(tokenIndex: number): Int32Array {
    return this.postings.subarray(
      this.postingsOffsets[tokenIndex],
      this.postingsOffsets[tokenIndex + 1],
    );
  }

  /**
   * Union of the posting lists of every token starting with `prefix`.
   * Returns null when no token matches.
   */
  private expandPrefix(prefix: string): Int32Array | null {
    let start = this.lowerBound(prefix);
    // Handle a prefix that sorts before the exact token (e.g. "abc" vs "abcd").
    while (start > 0 && this.tokenAt(start - 1).startsWith(prefix)) start -= 1;
    if (start >= this.tokenCount || !this.tokenAt(start).startsWith(prefix)) return null;

    let merged: number[] | null = null;
    for (let i = start; i < this.tokenCount; i++) {
      if (!this.tokenAt(i).startsWith(prefix)) break;
      const list = this.postingsOf(i);
      if (merged === null) merged = Array.from(list);
      else mergeInto(merged, list);
    }
    return merged === null ? null : Int32Array.from(merged);
  }

  private scanSubstring(token: string): Int32Array {
    const out: number[] = [];
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].search.includes(token)) out.push(i);
    }
    return Int32Array.from(out);
  }

  search(rawQuery: string, limit = MAX_RESULTS): SearchHit[] {
    const query = rawQuery.trim().toLowerCase();
    if (query.length === 0) return [];

    const tokens = query.split(/[\s\-_.,/|\\:;()[\]{}'"+*#@!?=&]+/).filter((t) => t.length > 0);
    if (tokens.length === 0) return [];

    let working: Int32Array | null = null;
    for (let t = 0; t < tokens.length; t++) {
      const list = this.expandPrefix(tokens[t]) ?? this.scanSubstring(tokens[t]);
      if (list.length === 0) return [];
      working = working === null ? list : intersect(working, list);
      if (working.length === 0) return [];
    }
    if (working === null) return [];

    const hits: SearchHit[] = [];
    const cap = Math.min(working.length, Math.max(limit * 4, 200));
    for (let i = 0; i < cap; i++) {
      const index = working[i];
      hits.push({ item: this.items[index], index, score: this.score(index, query, tokens) });
    }
    hits.sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length);

    return hits.length > limit ? hits.slice(0, limit) : hits;
  }

  private score(index: number, fullQuery: string, tokens: string[]): number {
    const name = this.items[index].name.toLowerCase();
    let score = 0;
    if (name.startsWith(fullQuery)) score += 1000;
    else if (name.includes(fullQuery)) score += 500;
    for (let t = 0; t < tokens.length; t++) {
      const token = tokens[t];
      if (name.startsWith(token)) {
        score += 120;
        continue;
      }
      const at = name.indexOf(token);
      if (at > 0) {
        const prev = name.charCodeAt(at - 1);
        const isWordStart = prev === 32 || prev === 45 || prev === 46 || prev === 95;
        score += isWordStart ? 60 : 25;
      }
    }
    // Shorter titles are usually the primary match ("Kantara" over "Kantara: Legend").
    score += Math.max(0, 60 - name.length / 4);
    return score;
  }
}

/** `dest` is a plain ascending array; `src` is an ascending Int32Array. */
function mergeInto(dest: number[], src: Int32Array): void {
  let i = 0;
  let j = 0;
  const merged: number[] = [];
  while (i < dest.length && j < src.length) {
    if (dest[i] < src[j]) merged.push(dest[i++]);
    else if (src[j] < dest[i]) merged.push(src[j++]);
    else {
      merged.push(dest[i]);
      i++;
      j++;
    }
  }
  while (i < dest.length) merged.push(dest[i++]);
  while (j < src.length) merged.push(src[j++]);
  dest.length = 0;
  for (let k = 0; k < merged.length; k++) dest.push(merged[k]);
}

function intersect(a: Int32Array, b: Int32Array): Int32Array {
  const small = a.length <= b.length ? a : b;
  const large = a.length <= b.length ? b : a;
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < small.length && j < large.length) {
    if (small[i] < large[j]) i++;
    else if (large[j] < small[i]) j++;
    else {
      out.push(small[i]);
      i++;
      j++;
    }
  }
  return Int32Array.from(out);
}
