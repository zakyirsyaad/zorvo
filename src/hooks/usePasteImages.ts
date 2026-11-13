import { useCallback, type ClipboardEvent } from 'react';
import { attachPastedImages, pastedImageFiles } from '../lib/pasted-images';
import { useLatest } from './useLatest';

interface PasteImagesOptions {
  /**
   * What a paste started now would belong to, or null while the composer takes no input (disabled,
   * hidden, no way to report a failure). It must change whenever the message the images were pasted
   * into is gone: another session on screen, Send, a clear or a restore. It is read when the paste
   * starts and again when the save ends, and an image whose scope changed in between is dropped.
   */
  scopeOf: () => string | null;
  /** Gets the paths of the saved images, as the paperclip's picked files are. */
  onPaths: (paths: readonly string[]) => void;
  onNotice: (message: string) => void;
}

const LEFT_OUT = 'Left out the pasted image: the message changed while it was saved.';

/**
 * The `onPaste` of the prompt. A paste that holds images and no text (see `pastedImageFiles`)
 * is taken over: the images are saved by the backend and handed to `onPaths`. Any other paste is
 * left alone, so text pastes as the browser does it.
 */
export function usePasteImages(options: PasteImagesOptions) {
  const latest = useLatest(options);
  return useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      const scope = latest.current.scopeOf();
      if (scope === null) return;
      const images = pastedImageFiles(event.clipboardData);
      if (images.length === 0) return;
      event.preventDefault();
      void attachPastedImages(images, (message) => latest.current.onNotice(message)).then((paths) => {
        if (paths.length === 0) return;
        if (latest.current.scopeOf() !== scope) latest.current.onNotice(LEFT_OUT);
        else latest.current.onPaths(paths);
      });
    },
    [latest],
  );
}
