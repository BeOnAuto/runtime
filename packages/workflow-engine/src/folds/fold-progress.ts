export interface FoldPlace {
  readonly event: number;
  readonly view: number;
}

export interface FoldProgress {
  readonly shared: SharedArrayBuffer;
  readonly mark: (event: number, view: number) => void;
  readonly last: () => FoldPlace | undefined;
}

const nowhere = -1;

const places = 2;

export function progressOf(shared: SharedArrayBuffer): FoldProgress {
  const place = new Int32Array(shared);
  return {
    shared,
    mark: (event, view) => {
      Atomics.store(place, 0, event);
      Atomics.store(place, 1, view);
    },
    last: () => {
      const event = Atomics.load(place, 0);
      return event === nowhere ? undefined : { event, view: Atomics.load(place, 1) };
    },
  };
}

export function foldProgress(): FoldProgress {
  const shared = new SharedArrayBuffer(places * Int32Array.BYTES_PER_ELEMENT);
  new Int32Array(shared).fill(nowhere);
  return progressOf(shared);
}
