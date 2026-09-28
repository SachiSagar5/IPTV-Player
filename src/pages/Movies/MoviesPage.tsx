import { CatalogPage } from '@/components/layout/CatalogPage';

export default function MoviesPage() {
  return (
    <CatalogPage
      kind="movie"
      title="Movies"
      variant="poster"
      // Newest release first: a provider playlist is usually alphabetical, which
      // buries this year's films. Undated entries fall to the end rather than
      // pretending to be from 1970.
      defaultSort="year"
      emptyTitle="No movies found"
      emptyMessage="This playlist has no entries classified as movies. Providers rarely label them explicitly, so classification is best-effort."
    />
  );
}
