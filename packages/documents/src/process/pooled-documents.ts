import type { ProcessValue } from '@on.auto/workflow-engine/process-loop';
import { Option, Schema } from 'effect';

import { notRead, type DocumentGiven, type DocumentRead, type DocumentText } from '../reading/document-text.ts';
import { documentTypeOf } from '../reading/media-types.ts';
import { documentJobKind } from './document-jobs.ts';

export interface ReadingBounds {
  readonly deadlineMs: number;
  readonly signal: Readonly<AbortSignal> | undefined;
  readonly textBytes: number;
}

export type DocumentReading = (given: DocumentGiven, bounds: ReadingBounds) => Promise<DocumentText>;

type Stopped = 'timed_out' | 'out_of_memory' | 'busy' | 'cancelled' | 'closing';

type ProcessOutcome = { readonly milliseconds: number } & (
  | { readonly ended: 'answered'; readonly answer: ProcessValue }
  | { readonly ended: 'crashed'; readonly detail: string }
  | { readonly ended: Stopped }
);

type ModuleAddress = () => Readonly<URL>;

interface DocumentJob {
  readonly module: ModuleAddress;
  readonly key: string;
  readonly kind: string;
  readonly payload: ProcessValue;
  readonly deadlineMs: number;
}

export interface DocumentProcesses {
  readonly run: (job: DocumentJob, signal?: Readonly<AbortSignal>) => Promise<ProcessOutcome>;
}

const DocumentReadSchema = Schema.Union([
  Schema.Struct({ read: Schema.Literal(true), text: Schema.String }),
  Schema.Struct({ read: Schema.Literal(false), because: Schema.String }),
]);

const decodeRead = Schema.decodeUnknownOption(DocumentReadSchema);

const documentsKey = 'documents';

const unread =
  'The runtime reads no document here, since it was composed with no process to read one in, and it reads none in its own';

const notAReading = 'The process that read it answered what is not the text of a document';

export function documentProcessModule(): URL {
  return new URL('./document-process.ts', import.meta.url);
}

function stoppedWords(stopped: Stopped, deadlineMs: number): string {
  const words: Readonly<Record<Stopped, string>> = {
    timed_out: `It took longer to read than the ${(Math.max(0, deadlineMs) / 1000).toFixed(1)} s the call had left, so its reading was stopped`,
    out_of_memory:
      'It took more memory to read than a process that reads a document may take, so its reading was stopped',
    cancelled: 'The call ended before it was read',
    busy: 'Every process that reads a document stayed busy for the time the call had left',
    closing: 'The server was closing, so it was not read',
  };
  return words[stopped];
}

function ranOutOfTime(signal: Readonly<AbortSignal> | undefined): boolean {
  const reason: unknown = signal?.reason;
  return reason instanceof Error && reason.name === 'TimeoutError';
}

function readOf(outcome: ProcessOutcome, { deadlineMs, signal }: ReadingBounds): DocumentRead {
  if (outcome.ended === 'answered') {
    return Option.getOrElse(decodeRead(outcome.answer), () => notRead(notAReading));
  }
  if (outcome.ended === 'crashed') {
    return notRead(`The process that read it ended without an answer: ${outcome.detail}`);
  }
  const stopped = outcome.ended === 'cancelled' && ranOutOfTime(signal) ? 'timed_out' : outcome.ended;
  return notRead(stoppedWords(stopped, deadlineMs));
}

export function documentsReadIn(
  pool: DocumentProcesses,
  module: ModuleAddress = documentProcessModule,
): DocumentReading {
  return async ({ bytes, mediaType, name }, bounds) => {
    const { deadlineMs, signal, textBytes } = bounds;
    const outcome = await pool.run(
      {
        module,
        key: documentsKey,
        kind: documentJobKind,
        payload: { bytes, mediaType, name: name ?? null, textBytes },
        deadlineMs,
      },
      signal,
    );
    return { ...readOf(outcome, bounds), mediaType: documentTypeOf(mediaType, name).mediaType };
  };
}

export const unreadDocuments: DocumentReading = ({ mediaType, name }) =>
  Promise.resolve({ ...notRead(unread), mediaType: documentTypeOf(mediaType, name).mediaType });
