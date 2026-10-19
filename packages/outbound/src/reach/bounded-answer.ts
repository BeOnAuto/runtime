class AnswerTooLarge extends Error {}

export function boundedAnswerOf(response: Readonly<Response>, mostBytes: number, tooLarge: () => void): Response {
  if (response.body === null) {
    return response;
  }
  let read = 0;
  const counting = new TransformStream<Uint8Array, Uint8Array>({
    transform: (chunk: Readonly<Uint8Array>, controller: Readonly<TransformStreamDefaultController<Uint8Array>>) => {
      read += chunk.byteLength;
      if (read > mostBytes) {
        tooLarge();
        controller.error(new AnswerTooLarge(`The answer takes more than the ${mostBytes} bytes it may take`));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  return new Response(response.body.pipeThrough(counting), response);
}
