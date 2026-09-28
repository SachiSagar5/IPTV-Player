/**
 * Fullscreen and Picture-in-picture.
 *
 * Both are feature-detected. The web standard `requestFullscreen` is
 * cross-browser awkward (Safari needs `webkit*` prefixes and only allows
 * fullscreen on the element itself, not a wrapper), so both paths are handled
 * and the exposed `isFullscreen` is the single source of truth the control bar
 * and the Escape key consult.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
};

export interface FullscreenApi {
  isFullscreen: boolean;
  isSupported: boolean;
  enter: () => void;
  exit: () => void;
  toggle: () => void;
}

export function useFullscreen(ref: RefObject<HTMLElement | null>): FullscreenApi {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const doc = document as FullscreenDocument;
    const onChange = (): void => {
      setIsFullscreen(Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const isSupported =
    typeof document !== 'undefined' &&
    Boolean(
      document.fullscreenEnabled ??
        (document as FullscreenDocument).webkitFullscreenEnabled ??
        false,
    );

  const enter = useCallback(() => {
    const node = ref.current as FullscreenElement | null;
    if (!node) return;
    const request = node.requestFullscreen ?? node.webkitRequestFullscreen;
    if (request) {
      try {
        const result = request.call(node);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(() => undefined);
        }
      } catch {
        /* rejected by the browser (e.g. no user gesture) */
      }
    }
  }, [ref]);

  const exit = useCallback(() => {
    const doc = document as FullscreenDocument;
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) return;
    const request = doc.exitFullscreen ?? doc.webkitExitFullscreen;
    if (request) {
      try {
        const result = request.call(doc);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(() => undefined);
        }
      } catch {
        /* ignore */
      }
    }
  }, []);

  const toggle = useCallback(() => {
    const doc = document as FullscreenDocument;
    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) exit();
    else enter();
  }, [enter, exit]);

  return { isFullscreen, isSupported, enter, exit, toggle };
}

type VideoWithPip = HTMLVideoElement & {
  requestPictureInPicture?: () => Promise<PictureInPictureWindow>;
};

export interface PipApi {
  isSupported: boolean;
  isActive: boolean;
  toggle: () => void;
  enter: () => void;
  exit: () => void;
}

export function usePictureInPicture(ref: RefObject<HTMLVideoElement | null>): PipApi {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const onEnter = (): void => setIsActive(true);
    const onLeave = (): void => setIsActive(false);
    const video = ref.current;
    if (!video) return;
    video.addEventListener('enterpictureinpicture', onEnter);
    video.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter);
      video.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, [ref]);

  // Probed once: this creates a throwaway <video>, which is not free.
  const isSupported = useMemo(() => {
    if (typeof document === 'undefined') return false;
    const doc = document as Document & { pictureInPictureEnabled?: boolean };
    if (doc.pictureInPictureEnabled) return true;
    const probe = document.createElement('video') as HTMLVideoElement & {
      webkitSetPresentationMode?: (mode: string) => void;
    };
    return typeof probe.webkitSetPresentationMode === 'function';
  }, []);

  const enter = useCallback(() => {
    const video = ref.current as VideoWithPip | null;
    if (!video) return;
    try {
      if (video.requestPictureInPicture) {
        const result = video.requestPictureInPicture();
        if (result && typeof result.catch === 'function') result.catch(() => undefined);
        return;
      }
      const legacy = (video as unknown as { webkitSetPresentationMode?: (m: string) => void })
        .webkitSetPresentationMode;
      if (legacy) legacy.call(video, 'picture-in-picture');
    } catch {
      /* user agent refused (usually because of autoplay policy) */
    }
  }, [ref]);

  const exit = useCallback(() => {
    const video = ref.current as VideoWithPip | null;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) void document.exitPictureInPicture();
      const legacy = (video as unknown as { webkitSetPresentationMode?: (m: string) => void })
        .webkitSetPresentationMode;
      if (legacy) legacy.call(video, 'inline');
    } catch {
      /* ignore */
    }
  }, [ref]);

  const toggle = useCallback(() => {
    if (isActive) exit();
    else enter();
  }, [isActive, enter, exit]);

  return { isSupported, isActive, toggle, enter, exit };
}
