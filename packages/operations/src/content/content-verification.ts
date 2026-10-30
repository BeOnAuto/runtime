import { sha256Digest } from './content-digest.ts';
import { notTheBytesOfItsDigest } from './content-refusals.ts';

function notBytes(sha256: string): Error {
  return new Error(`The content kept under ${sha256} was read back in a piece that is not bytes`);
}

export function verifiedStream(
  sha256: string,
  bytes: number,
  source: ReadableStream<unknown>,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const digest = sha256Digest();
  let read = 0;
  const ended = (controller: ReadableStreamDefaultController<Uint8Array>, last?: Readonly<Uint8Array>) => {
    if (read !== bytes || digest.hex() !== sha256) {
      controller.error(notTheBytesOfItsDigest(sha256));
      return;
    }
    if (last !== undefined) {
      controller.enqueue(last);
    }
    controller.close();
  };
  const failed = async (controller: ReadableStreamDefaultController<Uint8Array>, failure: Readonly<Error>) => {
    controller.error(failure);
    await reader.cancel();
  };
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      const next = await reader.read();
      if (next.done) {
        ended(controller);
        return;
      }
      if (!(next.value instanceof Uint8Array)) {
        await failed(controller, notBytes(sha256));
        return;
      }
      digest.update(next.value);
      read += next.value.byteLength;
      if (read < bytes) {
        controller.enqueue(next.value);
        return;
      }
      const after = read === bytes ? await reader.read() : undefined;
      if (after?.done === true) {
        ended(controller, next.value);
        return;
      }
      await failed(controller, notTheBytesOfItsDigest(sha256));
    },
    cancel: (reason) => reader.cancel(reason),
  });
}
