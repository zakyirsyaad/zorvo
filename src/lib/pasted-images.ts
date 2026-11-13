import { invoke } from '@tauri-apps/api/core';

/** The backend's cap too (`MAX_PASTED_BYTES`): a bigger image is refused here without being sent. */
export const MAX_PASTED_IMAGE_BYTES = 10 * 1024 * 1024;

/** The part of a paste event's `clipboardData` that decides what a paste is. */
export interface PasteData {
  readonly files?: ArrayLike<File>;
  readonly items?: ArrayLike<{ kind: string; type: string; getAsFile: () => File | null }>;
  getData: (format: string) => string;
}

const isImage = (file: File) => file.type.startsWith('image/');

/**
 * The images a paste should attach, or none when the paste is for the text box.
 *
 * Text wins whenever the clipboard holds some: a web page, a spreadsheet or a rich text editor
 * puts an image of what was copied beside its text, and the user expects the text. The one
 * exception is a copied image file, which some browsers also offer as its own name: text that is
 * only the name of an image on the clipboard is not text.
 */
export function pastedImageFiles(data: PasteData | null | undefined): File[] {
  if (!data) return [];
  const listed = Array.from(data.files ?? []).filter(isImage);
  const images =
    listed.length > 0
      ? listed
      : Array.from(data.items ?? [])
          .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null && isImage(file));
  if (images.length === 0) return [];
  const text = data.getData('text/plain').trim();
  if (text !== '' && !images.some((file) => file.name === text)) return [];
  return images;
}

/** The file's bytes as base64, which is how the backend takes them. */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('The image could not be read'));
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

function reasonOf(error: unknown): string {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : 'something went wrong';
  const plain = message.charAt(0).toLowerCase() + message.slice(1);
  return plain.endsWith('.') ? plain : `${plain}.`;
}

const notAttached = (reason: string) => `Could not attach the pasted image: ${reason}`;

/**
 * Saves each image through the backend, which checks and stores it, and returns the paths of those
 * that were saved, in order. A failure is said to `onNotice` and does not stop the others.
 */
export async function attachPastedImages(
  files: readonly File[],
  onNotice: (message: string) => void,
): Promise<string[]> {
  const paths: string[] = [];
  for (const file of files) {
    if (file.size > MAX_PASTED_IMAGE_BYTES) {
      onNotice(notAttached(`it is larger than ${MAX_PASTED_IMAGE_BYTES / (1024 * 1024)} MB.`));
      continue;
    }
    try {
      paths.push(await invoke<string>('save_pasted_image', { data: await base64Of(file) }));
    } catch (error) {
      onNotice(notAttached(reasonOf(error)));
    }
  }
  return paths;
}
