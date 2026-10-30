export interface ShippedFile {
  readonly package: string;
  readonly path: string;
}

export type ShippedRoots = Readonly<Record<string, Readonly<URL>>>;

export interface DependencyFile {
  readonly dependency: string;
  readonly path: string;
}

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

const dependencies = 'node_modules/';

export function dependencyFileOf(dependent: string, dependency: string, path: string): ShippedFile {
  return { package: dependent, path: `${dependencies}${dependency}/${path}` };
}

export function dependencyFileIn({ path }: ShippedFile): DependencyFile | undefined {
  if (!path.startsWith(dependencies)) {
    return undefined;
  }
  const within = path.slice(dependencies.length);
  const dependency = within
    .split('/')
    .slice(0, within.startsWith('@') ? 2 : 1)
    .join('/');
  return { dependency, path: within.slice(dependency.length + 1) };
}
