import { shippedFileName, type ShippedFile, type ShippedFiles } from './shipped-files.ts';

type Content = string | Readonly<Uint8Array>;

type Held = Readonly<Record<string, Readonly<Record<string, Content>>>>;

function heldIn(held: Held, file: ShippedFile): Readonly<Record<string, Content>> {
  return held[file.package] ?? {};
}

function contentOf(held: Held, file: ShippedFile): Promise<Content> {
  const content = heldIn(held, file)[file.path];
  return content === undefined
    ? Promise.reject(new Error(`No file is shipped at ${shippedFileName(file)}`))
    : Promise.resolve(content);
}

function textOf(content: Content): string {
  return typeof content === 'string' ? content : new TextDecoder().decode(content);
}

function bytesOf(content: Content): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
}

function namesIn(held: Held, folder: ShippedFile): Promise<readonly string[]> {
  const prefix = `${folder.path}/`;
  const under = Object.keys(heldIn(held, folder)).filter((path) => path.startsWith(prefix));
  if (under.length === 0) {
    return Promise.reject(new Error(`No folder is shipped at ${shippedFileName(folder)}`));
  }
  return Promise.resolve(
    under
      .map((path) => path.slice(prefix.length))
      .filter((name) => !name.includes('/'))
      .toSorted(),
  );
}

export function shippedFilesInMemory(held: Held): ShippedFiles {
  return {
    text: (file) => contentOf(held, file).then(textOf),
    bytes: (file) => contentOf(held, file).then(bytesOf),
    list: (folder) => namesIn(held, folder),
  };
}
