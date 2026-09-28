/**
 * `RatingBadge` — an IMDb score, e.g. a star and `8.8`.
 *
 * Renders nothing until a rating is known. That is not just cosmetic: a zero,
 * an empty star or a skeleton would all be a *lie* about a title that simply has
 * no rating, and the whole surface here is a confidence signal.
 *
 * The score is coloured by band rather than decorated further, so it stays
 * legible at both the detail-header size and the smaller player-overlay size, and
 * it inherits the surrounding text colour when the `tone` prop is omitted.
 */
import { Icon } from '@/components/common/Icon';

interface RatingBadgeProps {
  rating?: number;
  /** Tight type for use inside a poster card's chip row. */
  compact?: boolean;
  className?: string;
}

/** IMDb's own bands: green 7+, gold 6+, orange 5+, red below. */
function bandColor(rating: number): string {
  if (rating >= 7) return 'text-jade-300';
  if (rating >= 6) return 'text-yellow-300';
  if (rating >= 5) return 'text-orange-300';
  return 'text-red-300';
}

export function RatingBadge({ rating, compact = false, className = '' }: RatingBadgeProps) {
  if (rating === undefined || !Number.isFinite(rating)) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 tabular-nums ${className}`}
      // A bare "8.8" gives a screen reader no context, and the star glyph would
      // be read as decoration at best.
      aria-label={`IMDb rating ${rating} out of 10`}
      title="IMDb rating"
    >
      <Icon
        name="star"
        size={compact ? 9 : 12}
        filled
        className={bandColor(rating)}
        aria-hidden="true"
      />
      <span className={`font-semibold ${bandColor(rating)} ${compact ? 'text-[9px]' : 'text-xs'}`}>
        {rating.toFixed(1)}
      </span>
    </span>
  );
}
