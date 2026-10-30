import {
  defineHttpOperation,
  InvalidInput,
  PlaybookContext,
  type ContentRefused,
  type RecordedContent,
  type StreamedContent,
} from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import { grains } from '../periods/grains.ts';
import { checkedUpload } from './checked-upload.ts';
import { CsvFault } from './csv-fault.ts';

const DigestField = Schema.String.annotate({
  description: 'The SHA-256 of the body, 64 lowercase hexadecimal digits',
}).check(Schema.isPattern(/^[0-9a-f]{64}$/u));

const UploadedSchema = Schema.Struct({
  dataset: Schema.String.annotate({ description: 'The SHA-256 a definition names as data.dataset' }),
  bytes: Schema.Int,
  rows: Schema.Int,
  series: Schema.Int,
  columns: Schema.Array(Schema.String).annotate({ description: 'The target and the features, in the header’s order' }),
  period: Schema.Literals(grains),
  first_period: Schema.String,
  last_period: Schema.String,
});

function refusedBody(
  { because, cause, found }: Pick<ContentRefused, 'because' | 'cause' | 'found'>,
  sha256: string,
): Effect.Effect<never, InvalidInput> {
  if (because === 'stream_failed' && cause instanceof CsvFault) {
    const detail = `Line ${cause.line}: ${cause.message}`;
    return Effect.fail(
      new InvalidInput({ detail: `The dataset is refused at line ${cause.line}`, issues: [{ pointer: '', detail }] }),
    );
  }
  if (because !== 'not_its_digest' || found === undefined) {
    return Effect.die(cause);
  }
  const detail = `The body's digest is ${found.sha256} and the path says ${sha256}`;
  return Effect.fail(new InvalidInput({ detail, issues: [{ pointer: '/sha256', detail }] }));
}

export function uploadDataset(content: Pick<RecordedContent, 'put'>) {
  return defineHttpOperation('playbook', 'command', {
    name: 'upload_dataset',
    title: 'Upload dataset',
    description: [
      'Keeps an uploaded dataset that a prediction function names as data.dataset in place of a projection of the playbook’s history.',
      'The body is CSV in UTF-8 with the header series,period then the target and the features, one row a series and period, sorted by series then period, each value a JSON number or empty.',
      'The path names the SHA-256 of the body, and a body whose digest is not the path’s is refused, as is one that breaks the grammar, at its first faulty line; nothing is kept then.',
    ].join(' '),
    route: { method: 'PUT', path: '/datasets/{sha256}' },
    body: { kind: 'csv', mostBytes: predictionBounds.mostDatasetBytes },
    inputSchema: Schema.Struct({ sha256: DigestField }),
    answer: { kind: 'json', outputSchema: UploadedSchema },
    reasons: ['invalid_input'],
    handle: ({ sha256 }, body: StreamedContent) =>
      Effect.gen(function* () {
        const playbook = yield* PlaybookContext;
        const checked = checkedUpload(body.stream);
        const put = yield* Effect.result(
          content.put(playbook, { stream: checked.stream, mediaType: 'text/csv', expected: { sha256 } }),
        );
        if (Result.isFailure(put)) {
          return yield* refusedBody(put.failure, sha256);
        }
        const kept = put.success;
        const figures = yield* Effect.promise(() => checked.read);
        return {
          dataset: kept.sha256,
          bytes: kept.bytes,
          rows: figures.rows,
          series: figures.series,
          columns: figures.columns,
          period: figures.period,
          first_period: figures.firstPeriod,
          last_period: figures.lastPeriod,
        };
      }),
  });
}
