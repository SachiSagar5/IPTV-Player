/**
 * Content-based recommendation engine.
 *
 * Uses item metadata (genre, actors, director, year, series, etc.) to find
 * similar content. No external API calls - everything runs locally on the
 * user's device for privacy.
 */

import type { ContentItem } from '@/types';
import { cleanTitle } from '@/services/m3u/categorize';

export interface Recommendation {
  item: ContentItem;
  score: number;
  reason: string;
}

/**
 * Build a feature vector for an item based on its metadata.
 * Features are weighted by discriminative power.
 */
interface ItemFeatures {
  genres: Set<string>;
  languages: Set<string>;
  countries: Set<string>;
  year?: number;
  seriesId?: string;
  director?: string;
  actors: Set<string>;
  keywords: Set<string>;
}

function extractFeatures(item: ContentItem): ItemFeatures {
  const features: ItemFeatures = {
    genres: new Set(),
    languages: new Set(),
    countries: new Set(),
    actors: new Set(),
    keywords: new Set(),
  };

  // Extract from group (often contains genre)
  if (item.group) {
    const parts = item.group.split(/[,/|;]/).map((p) => p.trim().toLowerCase());
    for (const part of parts) {
      if (part) features.genres.add(part);
    }
  }

  // Language
  if (item.language) {
    const langs = item.language.split(/[,/|;]/).map((l) => l.trim().toLowerCase());
    for (const lang of langs) {
      if (lang) features.languages.add(lang);
    }
  }

  // Country
  if (item.country) {
    features.countries.add(item.country.toUpperCase());
  }

  // Year
  if (item.year && item.year > 1900 && item.year <= new Date().getFullYear() + 2) {
    features.year = item.year;
  }

  // Series
  if (item.seriesId) {
    features.seriesId = item.seriesId;
  }

  // Extract actors/keywords from name (simple heuristic)
  const cleanName = cleanTitle(item.name).toLowerCase();
  const words = cleanName.split(/\s+/).filter((w) => w.length > 2);
  for (const word of words) {
    features.keywords.add(word);
  }

  // Extract potential director/actor patterns from name
  // e.g., "Movie (Dir. Christopher Nolan)" or "Movie - Actor Name"
  const dirMatch = item.name.match(/(?:Dir\.?|Director)\s*[:\-]?\s*([^()]+)/i);
  if (dirMatch) {
    const dir = dirMatch[1].trim();
    if (dir) features.actors.add(dir.toLowerCase());
  }

  const actorMatch = item.name.match(/(?:Starring|With|Ft\.?)\s*[:\-]?\s*([^()]+)/i);
  if (actorMatch) {
    const actors = actorMatch[1].split(/[,/&]/).map((a) => a.trim().toLowerCase());
    for (const actor of actors) {
      if (actor) features.actors.add(actor);
    }
  }

  return features;
}

/**
 * Compute similarity between two items (0-1).
 * Uses weighted Jaccard similarity across feature categories.
 */
function computeSimilarity(a: ItemFeatures, b: ItemFeatures): number {
  let score = 0;
  let totalWeight = 0;

  // Same series = very strong signal
  if (a.seriesId && b.seriesId && a.seriesId === b.seriesId) {
    return 0.95;
  }

  // Genre overlap (weight: 0.3)
  const genreWeight = 0.3;
  if (a.genres.size > 0 || b.genres.size > 0) {
    const intersection = [...a.genres].filter((g) => b.genres.has(g)).length;
    const union = a.genres.size + b.genres.size - intersection;
    if (union > 0) score += (intersection / union) * genreWeight;
  }
  totalWeight += genreWeight;

  // Language overlap (weight: 0.2)
  const langWeight = 0.2;
  if (a.languages.size > 0 || b.languages.size > 0) {
    const intersection = [...a.languages].filter((l) => b.languages.has(l)).length;
    const union = a.languages.size + b.languages.size - intersection;
    if (union > 0) score += (intersection / union) * langWeight;
  }
  totalWeight += langWeight;

  // Country overlap (weight: 0.15)
  const countryWeight = 0.15;
  if (a.countries.size > 0 || b.countries.size > 0) {
    const intersection = [...a.countries].filter((c) => b.countries.has(c)).length;
    const union = a.countries.size + b.countries.size - intersection;
    if (union > 0) score += (intersection / union) * countryWeight;
  }
  totalWeight += countryWeight;

  // Year proximity (weight: 0.1)
  const yearWeight = 0.1;
  if (a.year && b.year) {
    const diff = Math.abs(a.year - b.year);
    const yearScore = Math.max(0, 1 - diff / 10); // Within 10 years = high similarity
    score += yearScore * yearWeight;
  }
  totalWeight += yearWeight;

  // Actor/director overlap (weight: 0.15)
  const actorWeight = 0.15;
  if (a.actors.size > 0 || b.actors.size > 0) {
    const intersection = [...a.actors].filter((a) => b.actors.has(a)).length;
    const union = a.actors.size + b.actors.size - intersection;
    if (union > 0) score += (intersection / union) * actorWeight;
  }
  totalWeight += actorWeight;

  // Keyword overlap (weight: 0.1)
  const keywordWeight = 0.1;
  if (a.keywords.size > 0 || b.keywords.size > 0) {
    const intersection = [...a.keywords].filter((k) => b.keywords.has(k)).length;
    const union = a.keywords.size + b.keywords.size - intersection;
    if (union > 0) score += (intersection / union) * keywordWeight;
  }
  totalWeight += keywordWeight;

  // Normalize
  return totalWeight > 0 ? score / totalWeight : 0;
}

/**
 * Generate human-readable reason for recommendation.
 */
/**
 * Generate human-readable reason for recommendation.
 */
function generateReason(source: ContentItem, target: ContentItem, _similarity: number): string {
  const reasons: string[] = [];

  if (source.seriesId && target.seriesId && source.seriesId === target.seriesId) {
    return 'Same series';
  }

  const sourceFeatures = extractFeatures(source);
  const targetFeatures = extractFeatures(target);

  // Check genre overlap
  const commonGenres = [...sourceFeatures.genres].filter((g) => targetFeatures.genres.has(g));
  if (commonGenres.length > 0) {
    reasons.push(`Same genre: ${commonGenres.slice(0, 2).join(', ')}`);
  }

  // Check language
  const commonLangs = [...sourceFeatures.languages].filter((l) => targetFeatures.languages.has(l));
  if (commonLangs.length > 0) {
    reasons.push(`Language: ${commonLangs[0]}`);
  }

  // Check country
  const commonCountries = [...sourceFeatures.countries].filter((c) => targetFeatures.countries.has(c));
  if (commonCountries.length > 0) {
    reasons.push(`Region: ${commonCountries[0]}`);
  }

  // Check year proximity
  if (sourceFeatures.year && targetFeatures.year) {
    const diff = Math.abs(sourceFeatures.year - targetFeatures.year);
    if (diff <= 3) {
      reasons.push(`Similar era (${targetFeatures.year})`);
    }
  }

  // Check actors/directors
  const commonActors = [...sourceFeatures.actors].filter((a) => targetFeatures.actors.has(a));
  if (commonActors.length > 0) {
    reasons.push(`Starring ${commonActors[0]}`);
  }

  // Keyword overlap
  const commonKeywords = [...sourceFeatures.keywords].filter((k) => targetFeatures.keywords.has(k));
  if (commonKeywords.length > 0 && reasons.length === 0) {
    reasons.push(`Similar title: ${commonKeywords[0]}`);
  }

  if (reasons.length === 0) {
    return 'Because you watched similar content';
  }

  return reasons.slice(0, 2).join(' · ');
}

/**
 * Get recommendations for a given item from a pool of candidates.
 */
export function getRecommendations(
  sourceItem: ContentItem,
  candidateItems: readonly ContentItem[],
  options: { limit?: number; minScore?: number; excludeSameSeries?: boolean } = {}
): Recommendation[] {
  const { limit = 10, minScore = 0.25, excludeSameSeries = false } = options;

  const sourceFeatures = extractFeatures(sourceItem);

  const recommendations: Recommendation[] = [];

  for (const candidate of candidateItems) {
    // Skip self
    if (candidate.id === sourceItem.id) continue;

    // Optionally exclude same series
    if (excludeSameSeries && sourceItem.seriesId && candidate.seriesId === sourceItem.seriesId) {
      continue;
    }

    const candidateFeatures = extractFeatures(candidate);
    const score = computeSimilarity(sourceFeatures, candidateFeatures);

    if (score >= minScore) {
      recommendations.push({
        item: candidate,
        score,
        reason: generateReason(sourceItem, candidate, score),
      });
    }
  }

  // Sort by score descending
  recommendations.sort((a, b) => b.score - a.score);

  return recommendations.slice(0, limit);
}

/**
 * Get "Because you watched X" recommendations based on recently watched items.
 */
export function getContinueWatchingRecommendations(
  recentItems: readonly ContentItem[],
  candidateItems: readonly ContentItem[],
  options: { limit?: number; recencyWeight?: number } = {}
): Recommendation[] {
  const { limit = 10, recencyWeight = 0.8 } = options;

  // Aggregate features from recently watched items, weighted by recency
  const allRecommendations = new Map<string, { item: ContentItem; score: number; reasons: string[] }>();

  for (let i = 0; i < recentItems.length; i++) {
    const recent = recentItems[i];
    const recencyFactor = Math.pow(recencyWeight, i); // Exponential decay

    const recs = getRecommendations(recent, candidateItems, {
      limit: 20,
      minScore: 0.15,
    });

    for (const rec of recs) {
      const existing = allRecommendations.get(rec.item.id);
      const weightedScore = rec.score * recencyFactor;

      if (!existing || weightedScore > existing.score) {
        allRecommendations.set(rec.item.id, {
          item: rec.item,
          score: weightedScore,
          reasons: [rec.reason],
        });
      } else {
        existing.score = Math.max(existing.score, weightedScore);
        if (!existing.reasons.includes(rec.reason)) {
          existing.reasons.push(rec.reason);
        }
      }
    }
  }

  // Convert to array and sort
  const results = Array.from(allRecommendations.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => ({
      item: r.item,
      score: r.score,
      reason: r.reasons.join(' · '),
    }));

  return results;
}

/**
 * Get "More like this" recommendations for a specific item.
 */
export function getSimilarRecommendations(
  item: ContentItem,
  candidateItems: readonly ContentItem[],
  options: { limit?: number } = {}
): Recommendation[] {
  return getRecommendations(item, candidateItems, {
    limit: options.limit ?? 6,
    minScore: 0.3,
    excludeSameSeries: false,
  });
}

/**
 * Get trending/popular items as fallback when no history exists.
 */
export function getTrendingRecommendations(
  candidateItems: readonly ContentItem[],
  options: { limit?: number } = {}
): Recommendation[] {
  const { limit = 10 } = options;

  // Score by recency (newer = higher) and kind priority (movies > series > live)
  const scored = candidateItems
    .filter((item) => item.kind !== 'live') // Exclude live from trending
    .map((item) => {
      let score = 0;

      // Newer content scores higher
      if (item.year) {
        const currentYear = new Date().getFullYear();
        const age = currentYear - item.year;
        score += Math.max(0, 1 - age / 10); // 10-year half-life
      }

      // Movies and series score higher than 'other'
      if (item.kind === 'movie') score += 0.5;
      else if (item.kind === 'series') score += 0.3;

      return { item, score, reason: 'Trending now' };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, score, reason }) => ({ item, score, reason }));

  return scored;
}