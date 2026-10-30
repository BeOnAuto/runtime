import { RunIdInputField } from '@on.auto/definitions';
import { defineHttpOperation, PlaybookReader } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { waitingBuildOf } from './waiting-builds.ts';

const BuildRunInput = Schema.Struct({ run_id: RunIdInputField });

function keptStream(sha256: string) {
  return Effect.flatMap(PlaybookReader, (reader) =>
    Effect.map(reader.readContent(sha256), (content) => {
      const kept = Option.getOrThrow(Option.fromNullishOr(content));
      return { stream: kept.stream, bytes: kept.bytes };
    }),
  );
}

export const readBuildBrief = defineHttpOperation('playbook', 'query', {
  name: 'read_build_brief',
  title: 'Read build brief',
  description: [
    'Reads the brief of a build of a prediction function that waits for its trainer, as Markdown, whole.',
    'It is the text the trainer reads first: what to predict, from which rows, and the rules to follow.',
    'A run that is not a build, or a build that has ended or taken its answer, is refused.',
  ].join(' '),
  route: { method: 'GET', path: '/runs/{run_id}/build/brief' },
  body: { kind: 'none' },
  inputSchema: BuildRunInput,
  answer: { kind: 'stream', mediaType: 'text/markdown' },
  reasons: ['not_found', 'conflict'],
  handle: ({ run_id: id }) => Effect.flatMap(waitingBuildOf(id), ({ record }) => keptStream(record.build.brief_sha256)),
});

export const readBuildRows = defineHttpOperation('playbook', 'query', {
  name: 'read_build_rows',
  title: 'Read build rows',
  description: [
    'Reads the training rows of a build of a prediction function that waits for its trainer, as CSV, streamed.',
    'They are the rows a trainer fits a model on: the held-back periods the playbook scores candidates on are not among them.',
    'A run that is not a build, or a build that has ended or taken its answer, is refused.',
  ].join(' '),
  route: { method: 'GET', path: '/runs/{run_id}/build/rows' },
  body: { kind: 'none' },
  inputSchema: BuildRunInput,
  answer: { kind: 'stream', mediaType: 'text/csv' },
  reasons: ['not_found', 'conflict'],
  handle: ({ run_id: id }) =>
    Effect.flatMap(waitingBuildOf(id), ({ record }) => keptStream(record.build.training_sha256)),
});
