import { CsvFault } from './csv-fault.ts';
import { CsvReader } from './csv-records.ts';
import { uploadGrammar, type UploadedFigures } from './upload-grammar.ts';
import { utf8Of, withoutByteOrderMark } from './utf8-text.ts';

export interface CheckedUpload {
  readonly stream: ReadableStream<Uint8Array>;
  readonly read: Promise<UploadedFigures>;
}

const notUtf8 = 'The body is not text in UTF-8';

function joined(pending: Readonly<Uint8Array>, chunk: Readonly<Uint8Array>): Readonly<Uint8Array> {
  if (pending.length === 0) {
    return chunk;
  }
  const bytes = new Uint8Array(pending.length + chunk.length);
  bytes.set(pending);
  bytes.set(chunk, pending.length);
  return bytes;
}

export function checkedUpload(body: ReadableStream<Uint8Array>): CheckedUpload {
  const reader = new CsvReader();
  const grammar = uploadGrammar();
  const read = Promise.withResolvers<UploadedFigures>();
  const state: { pending: Readonly<Uint8Array>; started: boolean } = { pending: new Uint8Array(), started: false };
  const taken = (bytes: Readonly<Uint8Array>, ending: boolean): void => {
    const reading = utf8Of(bytes, ending);
    const text = state.started ? reading.text : withoutByteOrderMark(reading.text);
    state.started = state.started || text !== '';
    grammar.take(reader.read(text));
    if (reading.invalid) {
      throw new CsvFault(reader.line(), notUtf8);
    }
    state.pending = reading.rest;
  };
  const checking = new TransformStream<Uint8Array, Uint8Array>({
    transform: (chunk: Readonly<Uint8Array>, controller: Readonly<TransformStreamDefaultController<Uint8Array>>) => {
      taken(joined(state.pending, chunk), false);
      controller.enqueue(chunk);
    },
    flush: () => {
      taken(state.pending, true);
      grammar.take(reader.end());
      read.resolve(grammar.figures(reader.line()));
    },
  });
  return { stream: body.pipeThrough(checking), read: read.promise };
}
