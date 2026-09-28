# Roadmap

Work that is deliberately **not** done yet, recorded so it is not lost. Each
entry says what exists today, so the gap is verifiable rather than remembered.

---

## Xtream Codes and Stalker / Ministra portal support — not started

**Status: deferred.** Chosen on 2026-09-28, when the Android TV work was scoped:
the brief assumed this app already supported both. It does not.

### What exists today

The app is **M3U-only**. A playlist is identified by a single HTTP(S) URL that
returns an `#EXTM3U` document, and that is enforced at the entry point:

- `src/types/index.ts` — `PlaylistMeta` has `url: string` and no credentials,
  server, MAC or token field.
- `src/services/m3u/fetcher.ts` — `validatePlaylistUrl` rejects anything that is
  not `http:`/`https:`, and the response is rejected unless it contains
  `#EXTM3U`.

Searching the source for `portal`, `stalker`, `ministra`, `player_api`,
`get.php`, `mac`, `server_url` or `username` returns nothing. The only matches
for "xtream" are two cosmetic comments in `src/services/m3u/categorize.ts` about
trimming provider name prefixes such as `|EU|` — there is no Xtream API client.

### What is missing

- Xtream Codes: portal login, MAC-derived device identity, token lifecycle,
  `player_api.php` VOD/series/EPG endpoints, live stream URL generation.
- Stalker / Ministra: portal handshake, handshake parameters, profile/account
  endpoints, token refresh, archive and EPG retrieval.
- A provider abstraction so a portal and an M3U URL can both be a "playlist".

### Why it was deferred

It is a large piece of work in its own right, and the Android TV packaging
should not be held behind it. The Android TV build is entirely M3U-based today
and works.

### Good news for whoever picks it up

The seams are already in place:

- `StreamSource` and `ContentItem` (`src/types/index.ts`) are documented as
  transport-agnostic — no DOM, no React — specifically so a native or portal
  source can reuse them.
- `HlsEngine` is fully encapsulated behind a single `load()` call, so swapping
  how a stream URL is obtained does not touch playback.
- `src/store/store.ts` is a plain, React-free store, so provider setup can run
  outside the component tree.
- `src/services/storage/db.ts` is already chunked at 2000 items per IndexedDB
  record, which suits a portal returning tens of thousands of VOD entries.

The main structural change would be widening `PlaylistMeta` to carry provider
credentials, and adding a source-kind discriminator so the UI can offer "Add by
M3U URL" and "Add by portal credentials" as separate flows.
