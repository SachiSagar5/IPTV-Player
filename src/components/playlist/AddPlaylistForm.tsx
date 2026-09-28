/**
 * Add-playlist form.
 *
 * Shared by the first-run onboarding and the Playlists page so validation,
 * progress reporting and error handling are identical in both. The URL is
 * validated *before* the fetch so an obviously wrong address fails in
 * milliseconds rather than after a 25-second timeout.
 */
import { memo, useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Form';
import { Icon } from '@/components/common/Icon';
import { validatePlaylistUrl } from '@/services/m3u/fetcher';
import { addPlaylist, useAppSelector } from '@/store/appStore';

export interface AddPlaylistFormProps {
  autoFocus?: boolean;
  submitLabel?: string;
  className?: string;
}

export const AddPlaylistForm = memo(function AddPlaylistForm({
  autoFocus = false,
  submitLabel = 'Add playlist',
  className = '',
}: AddPlaylistFormProps) {
  const busy = useAppSelector((s) => s.busy);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const isBusy = busy !== null;

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (isBusy) return;

      // Pre-flight the URL so a typo does not become a 25s spinner.
      let resolvedName = name.trim();
      try {
        const parsed = validatePlaylistUrl(url);
        // `setName` would not be visible until the next render, so resolve the
        // fallback into a local and use that for the submit.
        if (!resolvedName) resolvedName = hostLabel(parsed);
        setName(resolvedName);
        setUrlError(null);
      } catch (error) {
        setUrlError(error instanceof Error ? error.message : 'That does not look like a valid URL.');
        return;
      }

      const added = await addPlaylist({ name: resolvedName, url: url.trim() });
      if (!added) return;
      setUrl('');
      setName('');
    },
    [isBusy, url, name],
  );

  return (
    <form onSubmit={submit} className={`space-y-3 ${className}`} noValidate>
      <Input
        label="Playlist URL"
        value={url}
        onChange={(event) => {
          setUrl(event.target.value);
          if (urlError) setUrlError(null);
        }}
        placeholder="https://example.com/playlist.m3u"
        icon="link"
        type="url"
        inputMode="url"
        autoComplete="url"
        spellCheck={false}
        autoFocus={autoFocus}
        enterKeyHint="go"
        error={urlError}
        hint="M3U or M3U8. Must be reachable from this device — CORS applies to the provider, not to us."
        disabled={isBusy}
      />

      <Input
        label="Name (optional)"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Derived from the URL if left blank"
        icon="playlist"
        autoComplete="off"
        disabled={isBusy}
      />

      <div className="flex items-center gap-2">
        <Button type="submit" icon="plus" loading={isBusy} disabled={url.trim() === ''}>
          {submitLabel}
        </Button>
        {isBusy && busy?.progress ? (
          <p className="min-w-0 flex-1 truncate text-xs text-mist-500">{busy.progress.detail}</p>
        ) : null}
      </div>

      {isBusy && busy?.progress?.ratio != null ? (
        <div
          className="h-1 overflow-hidden rounded-full bg-ink-700"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(busy.progress.ratio * 100)}
        >
          <div
            className="h-full rounded-full bg-accent-400 transition-[width] duration-200"
            style={{ width: `${Math.round(busy.progress.ratio * 100)}%` }}
          />
        </div>
      ) : null}

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-mist-600">
        <Icon name="info" size={12} className="mt-0.5 shrink-0" />
        <span>
          Playlists are fetched, parsed and stored on this device only. Nothing is uploaded, and
          only the entries in the provider&rsquo;s own document are shown.
        </span>
      </p>
    </form>
  );
});

/** `https://host/dir/list.m3u` → "host" as a friendly default name. */
function hostLabel(url: URL): string {
  return url.hostname.replace(/^www\./, '');
}
