export type StreamAppended = (stream: string) => void;

export interface StreamSignal {
  readonly raise: (stream: string) => void;
  readonly listen: (listener: StreamAppended) => () => void;
}

export function streamSignalOf(): StreamSignal {
  const listeners = new Set<StreamAppended>();
  return {
    raise: (stream) => {
      for (const listener of listeners) {
        listener(stream);
      }
    },
    listen: (listener) => {
      const own = (stream: string): void => {
        listener(stream);
      };
      listeners.add(own);
      return () => {
        listeners.delete(own);
      };
    },
  };
}

export const streamAppends: StreamSignal = streamSignalOf();

export function signalOf({ appended }: { readonly appended?: StreamSignal | undefined }): StreamSignal {
  return appended ?? streamAppends;
}
