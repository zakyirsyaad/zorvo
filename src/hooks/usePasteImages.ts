import { useCallback, type ClipboardEvent } from 'react';
import { attachPastedImages, pastedImageFiles } from '../lib/pasted-images';
import { useLatest } from './useLatest';

interface PasteImagesOptions {
  /** False while the composer takes no input: a paste then does nothing. */
  enabled: boolean;
  /** Gets the paths of the saved images, as the paperclip's picked files are. */
  onPaths: (paths: readonly string[]) => void;
  onNotice: (message: string) => void;
}

/**
 * The `onPaste` of the prompt. A paste that holds images and no text (see `pastedImageFiles`)
 * is taken over: the images are saved by the backend and handed to `onPaths`. Any other paste is
 * left alone, so text pastes as the browser does it.
 */
export function usePasteImages({ enabled, onPaths, onNotice }: PasteImagesOptions) {
  const latest = useLatest({ onPaths, onNotice });
  return useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      if (!enabled) return;
      const images = pastedImageFiles(event.clipboardData);
      if (images.length === 0) return;
      event.preventDefault();
      void attachPastedImages(images, (message) => latest.current.onNotice(message)).then((paths) => {
        if (paths.length > 0) latest.current.onPaths(paths);
      });
    },
    [enabled, latest],
  );
}
