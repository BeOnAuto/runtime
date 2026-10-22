import type { ShippedFiles } from './shipped-files.ts';

type Content = string | Readonly<Uint8Array>;

type Held = ReadonlyMap<string, Content>;

function contentOf(held: Held, file: Readonly<URL>): Promise<Content> {
  const content = held.get(file.href);
  return content === undefined
    ? Promise.reject(new Error(`No file is shipped at ${file.href}`))
    : Promise.resolve(content);
}

function textOf(content: Content): string {
  return typeof content === 'string' ? content : new TextDecoder().decode(content);
}

function bytesOf(content: Content): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
}

function namesIn(held: Held, folder: Readonly<URL>): Promise<readonly string[]> {
  const under = [...held.keys()].filter((href) => href.startsWith(folder.href));
  if (under.length === 0) {
    return Promise.reject(new Error(`No folder is shipped at ${folder.href}`));
  }
  return Promise.resolve(
    under
      .map((href) => href.slice(folder.href.length))
      .filter((name) => !name.includes('/'))
      .toSorted(),
  );
}

export function shippedFilesInMemory(files: Readonly<Record<string, Content>>): ShippedFiles {
  const held: Held = new Map(Object.entries(files));
  return {
    text: (file) => contentOf(held, file).then(textOf),
    bytes: (file) => contentOf(held, file).then(bytesOf),
    list: (folder) => namesIn(held, folder),
  };
}
