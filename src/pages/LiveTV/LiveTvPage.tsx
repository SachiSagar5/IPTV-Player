import { CatalogPage } from '@/components/layout/CatalogPage';

export default function LiveTvPage() {
  return (
    <CatalogPage
      kind="live"
      title="Live TV"
      variant="channel"
      showSort={false}
      showFavorites={false}
      emptyTitle="No live channels"
      emptyMessage="This playlist has no entries classified as live channels. If it should, add `group-title` hints or check the Movies tab."
    />
  );
}
