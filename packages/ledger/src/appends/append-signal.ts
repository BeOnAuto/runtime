import type { StreamStore } from '../event-store.ts';

export type AppendListener = (playbookKey: string) => void;

export interface AppendSignal {
  readonly raise: (stream: string) => void;
  readonly listen: (listener: AppendListener) => () => void;
}

const segmentsOfAPlaybookKey = 3;

export function playbookKeyOfStream(stream: string): string | undefined {
  const segments = stream.split('/');
  return segments.length > segmentsOfAPlaybookKey
    ? `${segments.slice(0, segmentsOfAPlaybookKey).join('/')}/`
    : undefined;
}

export function appendSignal(): AppendSignal {
  const listeners = new Set<AppendListener>();
  return {
    raise: (stream) => {
      const playbookKey = playbookKeyOfStream(stream);
      if (playbookKey !== undefined) {
        for (const listener of listeners) {
          listener(playbookKey);
        }
      }
    },
    listen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function signalledOn<Store extends StreamStore>(store: Store, signal?: AppendSignal): Store {
  if (signal === undefined) {
    return store;
  }
  return {
    ...store,
    append: async (stream, events, place) => {
      await store.append(stream, events, place);
      signal.raise(stream);
    },
  };
}
