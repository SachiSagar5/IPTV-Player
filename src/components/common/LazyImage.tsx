/**
 * LazyImage — the app's single image-loading strategy.
 *
 * Requirements it satisfies (all from the perf brief):
 *  - Nothing outside the viewport is ever requested. A shared IntersectionObserver
 *    serves every instance, so 5,000 cards still create one observer.
 *  - Explicit width/height are always emitted, so cards never reflow as images
 *    arrive (CLS is the metric that actually hurts a grid).
 *  - `decoding="async"` keeps image decode off the critical path.
 *  - Three visual states — loading placeholder, loaded image, error fallback —
 *    because provider logos 404 constantly and a broken-image glyph is not an
 *    acceptable fallback.
 */
import { memo, useEffect, useRef, useState } from 'react';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

let sharedObserver: IntersectionObserver | null = null;
const callbacks = new WeakMap<Element, () => void>();

function getObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  if (sharedObserver) return sharedObserver;
  sharedObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = callbacks.get(entry.target);
        if (callback) {
          callbacks.delete(entry.target);
          callback();
        }
        sharedObserver?.unobserve(entry.target);
      }
    },
    // Start fetching slightly before the element is on screen so the image is
    // usually decoded by the time it is needed.
    { rootMargin: '400px 0px', threshold: 0.01 },
  );
  return sharedObserver;
}

export interface LazyImageProps {
  src?: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  /** Monogram shown when there is no image, or when it fails. */
  fallbackText?: string;
  /** `contain` for channel logos, `cover` for posters. */
  fit?: 'cover' | 'contain';
  /** Forces an immediate load, bypassing the observer (e.g. the hero image). */
  priority?: boolean;
  rounded?: string;
  /** Extra classes applied only while the image is still loading. */
  loadingClassName?: string;
  onLoad?: () => void;
}

function initialsOf(alt: string): string {
  const words = alt
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '•';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export const LazyImage = memo(function LazyImage({
  src,
  alt,
  width,
  height,
  className = '',
  fallbackText,
  fit = 'cover',
  priority = false,
  rounded = '',
  loadingClassName = '',
  onLoad,
}: LazyImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(priority);
  const [state, setState] = useState<LoadState>(src ? 'loading' : 'error');

  useEffect(() => {
    if (priority || shouldLoad) return;
    const node = containerRef.current;
    if (!node) return;
    const observer = getObserver();
    // No IntersectionObserver (very old browsers): fall back to eager loading
    // rather than never rendering artwork.
    if (!observer) {
      setShouldLoad(true);
      return;
    }
    callbacks.set(node, () => setShouldLoad(true));
    observer.observe(node);
    return () => {
      callbacks.delete(node);
      observer.unobserve(node);
    };
  }, [priority, shouldLoad]);

  useEffect(() => {
    setState(src ? 'loading' : 'error');
  }, [src]);

  const showImage = Boolean(src) && shouldLoad && state !== 'error';
  const objectFit = fit === 'contain' ? 'object-contain' : 'object-cover';

  return (
    <div
      ref={containerRef}
      className={`poster-fallback relative overflow-hidden ${rounded} ${className}`}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={() => {
            setState('loaded');
            onLoad?.();
          }}
          onError={() => setState('error')}
          className={`media-img h-full w-full ${objectFit} ${
            state === 'loaded' ? 'opacity-100' : 'opacity-0'
          } ${loadingClassName}`}
        />
      ) : null}

      {state !== 'loaded' ? (
        <div
          className={`absolute inset-0 flex items-center justify-center bg-ink-850 ${
            state === 'error' ? '' : 'skeleton'
          }`}
        >
          {state === 'error' ? (
            <span className="px-2 text-center text-[0.6rem] font-bold tracking-widest text-mist-500 uppercase select-none line-clamp-2">
              {fallbackText ?? initialsOf(alt)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
