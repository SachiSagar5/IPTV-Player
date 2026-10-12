import { CatalogPage } from '@/components/layout/CatalogPage';

export default function MoviesPage() {
  return (
    <CatalogPage
      kind="movie"
      title="Movies"
      variant="poster"
      // Daily shuffle: a new random order every day so the catalog feels fresh.
      // Falls back to newest-first for users who prefer a stable sort.
      defaultSort="daily"
      emptyTitle="No movies found"
      emptyMessage="This playlist has no entries classified as movies. Providers rarely label them explicitly, so classification is best-effort."
    />
  );
}
