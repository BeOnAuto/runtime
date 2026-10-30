import { watch } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export interface WatchedSource {
  readonly directory: string;
  readonly recursive: boolean;
  readonly accepts: (file: string) => boolean;
}

export interface SourceChanges {
  readonly next: () => Promise<string>;
  readonly close: () => void;
}

const settleMs = 200;

export function isServerSource(file: string): boolean {
  return file.endsWith('.ts') && !file.endsWith('.test.ts');
}

export function sourcesOf(directories: readonly string[], envFiles: readonly string[]): readonly WatchedSource[] {
  return [
    ...directories.map((directory) => ({ directory, recursive: true, accepts: isServerSource })),
    ...envFiles.map((envFile) => ({
      directory: dirname(envFile),
      recursive: false,
      accepts: (file: string) => file === basename(envFile),
    })),
  ];
}

export function watchSources(sources: readonly WatchedSource[]): SourceChanges {
  let waiting = Promise.withResolvers<string>();
  let settling: NodeJS.Timeout | undefined;
  const changed = (path: string): void => {
    clearTimeout(settling);
    settling = setTimeout(() => {
      const settled = waiting;
      waiting = Promise.withResolvers<string>();
      settled.resolve(path);
    }, settleMs);
  };
  const watchers = sources.map(({ directory, recursive, accepts }) =>
    watch(directory, { recursive }, (_event, file) => {
      if (file !== null && accepts(file)) {
        changed(join(directory, file));
      }
    }),
  );
  return {
    next: () => waiting.promise,
    close: () => {
      clearTimeout(settling);
      for (const watcher of watchers) {
        watcher.close();
      }
    },
  };
}
