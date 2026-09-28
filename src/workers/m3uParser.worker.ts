/**
 * M3U parsing Web Worker.
 *
 * Runs entirely off the main thread so a 100k-entry playlist never produces a
 * long task. Vite bundles this via `new Worker(new URL(...), { type: 'module' })`
 * and the file is code-split out of the initial payload (it is only fetched when
 * the user first adds or refreshes a playlist).
 *
 * The worker also builds the search index so the main thread receives it as
 * transferable ArrayBuffers (zero-copy) instead of paying to construct it.
 */
import { parseM3U } from '@/services/m3u/parser';
import { buildCompactSearchIndex } from '@/utils/searchIndex';
import type { CompactSearchIndex } from '@/utils/searchIndex';
import { tallyItems } from '@/services/m3u/counts';
import type { ContentItem, ContentKind } from '@/types';

export interface ParseRequestMessage {
  type: 'parse';
  id: number;
  playlistId: string;
  text: string;
}

export type WorkerOutMessage =
  | { type: 'progress'; id: number; entries: number }
  | {
      type: 'done';
      id: number;
      items: ContentItem[];
      counts: Record<ContentKind, number>;
      adultCount: number;
      headerName?: string;
      skipped: number;
      compactIndex: CompactSearchIndex;
    }
  | { type: 'error'; id: number; message: string };

self.onmessage = (event: MessageEvent<ParseRequestMessage>): void => {
  const message = event.data;
  if (!message || message.type !== 'parse') return;

  try {
    const result = parseM3U(message.text, {
      playlistId: message.playlistId,
      progressEvery: 2500,
      onProgress: (entries: number) => {
        const progress: WorkerOutMessage = { type: 'progress', id: message.id, entries };
        self.postMessage(progress);
      },
    });

    const compactIndex = buildCompactSearchIndex(result.items);

    const tally = tallyItems(result.items);
    const done: WorkerOutMessage = {
      type: 'done',
      id: message.id,
      items: result.items,
      counts: tally.counts,
      adultCount: tally.adultCount,
      headerName: result.headerName,
      skipped: result.skipped,
      compactIndex,
    };

    // Transfer the index buffers; the worker no longer needs them.
    self.postMessage(done, [
      compactIndex.tokenOffsets.buffer,
      compactIndex.postingsOffsets.buffer,
      compactIndex.postings.buffer,
    ]);
  } catch (error) {
    const failure: WorkerOutMessage = {
      type: 'error',
      id: message.id,
      message:
        error instanceof Error
          ? `Parsing failed: ${error.message}`
          : 'Parsing failed unexpectedly.',
    };
    self.postMessage(failure);
  }
};
