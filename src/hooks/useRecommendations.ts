/**
 * Hook for content recommendations.
 */
import { useMemo } from 'react';
import { useAppSelector } from '@/store/appStore';
import type { ContentItem } from '@/types';
import {
  getRecommendations,
  getContinueWatchingRecommendations,
  getSimilarRecommendations,
  getTrendingRecommendations,
  type Recommendation,
} from '@/services/recommendations';

export function useRecommendations(
  sourceItem: ContentItem | null,
  options: { limit?: number; minScore?: number } = {}
): Recommendation[] {
  const items = useAppSelector((s) => s.items);

  return useMemo(() => {
    if (!sourceItem) return [];
    return getRecommendations(sourceItem, items, options);
  }, [sourceItem, items, options.limit, options.minScore]);
}

export function useContinueWatchingRecommendations(
  options: { limit?: number } = {}
): Recommendation[] {
  const items = useAppSelector((s) => s.items);
  const recents = useAppSelector((s) => s.recents);
  const recentsMap = useAppSelector((s) => s.itemById);

  return useMemo(() => {
    // Convert recents to ContentItems
    const recentItems: ContentItem[] = [];
    for (const recent of recents) {
      const item = recentsMap.get(recent.contentId);
      if (item) recentItems.push(item);
    }

    if (recentItems.length === 0) {
      // Fallback to trending
      return getTrendingRecommendations(items, options);
    }

    return getContinueWatchingRecommendations(recentItems, items, options);
  }, [recents, recentsMap, items, options.limit]);
}

export function useSimilarRecommendations(
  item: ContentItem | null,
  options: { limit?: number } = {}
): Recommendation[] {
  const items = useAppSelector((s) => s.items);

  return useMemo(() => {
    if (!item) return [];
    return getSimilarRecommendations(item, items, options);
  }, [item, items, options.limit]);
}

export function useTrendingRecommendations(
  options: { limit?: number } = {}
): Recommendation[] {
  const items = useAppSelector((s) => s.items);

  return useMemo(() => {
    return getTrendingRecommendations(items, options);
  }, [items, options.limit]);
}