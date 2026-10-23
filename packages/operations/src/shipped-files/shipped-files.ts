export interface ShippedFile {
  readonly package: string;
  readonly path: string;
}

export type ShippedRoots = Readonly<Record<string, Readonly<URL>>>;

export interface ShippedFiles {
  readonly text: (file: ShippedFile) => Promise<string>;
  readonly bytes: (file: ShippedFile) => Promise<Uint8Array>;
  readonly list: (folder: ShippedFile) => Promise<readonly string[]>;
}

export function shippedFileIn(folder: ShippedFile, name: string): ShippedFile {
  return { package: folder.package, path: `${folder.path}/${name}` };
}

export function shippedFileName(file: ShippedFile): string {
  return `${file.package}/${file.path}`;
}
