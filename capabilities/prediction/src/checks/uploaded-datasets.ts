import type { SavedDefinitions } from '@on.auto/definitions';
import { issueAt, type DocumentIssue } from '@on.auto/definitions/document';
import type { StreamedContent } from '@on.auto/operations';
import { Effect } from 'effect';

import { isProjected, type PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { grainOfForm, type Grain } from '../periods/grains.ts';
import { keptHeadOf } from '../upload/kept-head.ts';

interface UploadedHead {
  readonly grain: Grain;
  readonly target: string | undefined;
  readonly features: readonly string[];
}

interface Named {
  readonly digest: string;
  readonly features: readonly string[];
}

const datasetMediaType = 'text/csv';

function keptHeadIn(stream: ReadableStream<Uint8Array>): Effect.Effect<UploadedHead | null> {
  return Effect.map(
    Effect.promise(() => keptHeadOf(stream)),
    (head) => {
      const grain = head === undefined ? undefined : grainOfForm(head.firstPeriod);
      if (head === undefined || grain === undefined) {
        return null;
      }
      const [target, ...features] = head.columns;
      return { grain, target, features };
    },
  );
}

function uploadedHeadOf({ stream, mediaType }: StreamedContent): Effect.Effect<UploadedHead | null> {
  return mediaType === datasetMediaType
    ? keptHeadIn(stream)
    : Effect.as(
        Effect.promise(() => stream.cancel()),
        null,
      );
}

function headIssues(
  { predicts, lines }: PredictionFunctionDefinitionDocument,
  { digest, features }: Named,
  head: UploadedHead,
): readonly DocumentIssue[] {
  const uploaded = `The dataset uploaded under ${digest}`;
  const written = head.features.length === 0 ? 'no features' : `the features ${head.features.join(', ')}`;
  const issues: readonly (readonly [boolean, string, string])[] = [
    [
      head.grain === predicts.period,
      '/predicts/period',
      `${uploaded} holds a row for each ${head.grain}, not each ${predicts.period}; predict the grain it holds`,
    ],
    [
      head.target === predicts.target,
      '/predicts/target',
      `${uploaded} names its target ${String(head.target)} after series,period, not ${predicts.target}`,
    ],
    [
      head.features.join(',') === features.join(','),
      '/data/features',
      `${uploaded} has ${written} after its target, in that order; name its features so`,
    ],
  ];
  return issues.flatMap(([holds, pointer, detail]) => (holds ? [] : [issueAt(lines, pointer, detail)]));
}

export function uploadedDatasetIssues(
  document: PredictionFunctionDefinitionDocument,
  saved: SavedDefinitions,
): Effect.Effect<readonly DocumentIssue[]> {
  const { data, lines } = document;
  if (isProjected(data)) {
    return Effect.succeed([]);
  }
  const named = { digest: `${data.dataset.slice(0, 12)}…`, features: data.features };
  return Effect.gen(function* () {
    const kept = yield* saved.content(data.dataset);
    if (kept === undefined) {
      return [
        issueAt(
          lines,
          '/data/dataset',
          `This playbook keeps no dataset under ${named.digest}; upload it first, then name it`,
        ),
      ];
    }
    const head = yield* uploadedHeadOf(kept);
    return head === null
      ? [
          issueAt(
            lines,
            '/data/dataset',
            `What this playbook keeps under ${named.digest} is not a dataset uploaded as CSV`,
          ),
        ]
      : headIssues(document, named, head);
  });
}
