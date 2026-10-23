export interface ShippedFiles {
  readonly text: (file: Readonly<URL>) => Promise<string>;
  readonly bytes: (file: Readonly<URL>) => Promise<Uint8Array>;
  readonly list: (folder: Readonly<URL>) => Promise<readonly string[]>;
}
