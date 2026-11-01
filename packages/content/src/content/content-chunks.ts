export const mostContentChunkBytes = 1_048_576;

export interface Chunker {
  readonly filled: (piece: Readonly<Uint8Array>) => readonly Uint8Array<ArrayBuffer>[];
  readonly rest: () => readonly Uint8Array<ArrayBuffer>[];
}

export function chunkerOf(chunkBytes: number): Chunker {
  let chunk = new Uint8Array(chunkBytes);
  let filled = 0;
  return {
    filled: (piece) => {
      const whole: Uint8Array<ArrayBuffer>[] = [];
      for (let taken = 0; taken < piece.byteLength;) {
        const copied = Math.min(chunkBytes - filled, piece.byteLength - taken);
        chunk.set(piece.subarray(taken, taken + copied), filled);
        filled += copied;
        taken += copied;
        if (filled === chunkBytes) {
          whole.push(chunk);
          chunk = new Uint8Array(chunkBytes);
          filled = 0;
        }
      }
      return whole;
    },
    rest: () => (filled === 0 ? [] : [chunk.subarray(0, filled)]),
  };
}
