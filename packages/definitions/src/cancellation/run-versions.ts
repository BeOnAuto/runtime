import {
  playbookBoundProjectionReader,
  prefixedReader,
  streamPrefixOfPlaybook,
  type PlaybookAddress,
  type ProjectionReader,
  type StreamReader,
} from '@on.auto/operations';
import { Effect } from 'effect';

import type { ReadModelReader } from '../read-model-reads/read-model-rows.ts';
import { versionFromTheReadModelIn } from '../read-model-reads/read-model-versions.ts';
import { differingFieldsOf } from '../read-model-staging/same-answers.ts';
import { comparisonOf, stagedRead } from '../read-model-staging/shadow-comparison.ts';
import {
  definitionVersionIn,
  type DefinitionVersionAddress,
  type RecordedVersion,
} from '../registry/definition-versions.ts';

export interface VersionToPrepare extends Pick<RecordedVersion, 'source' | 'putInPlaceBy'> {
  readonly stripped: RecordedVersion['stripped'] | undefined;
}

interface VersionFound extends Pick<RecordedVersion, 'source' | 'putInPlaceBy'> {
  readonly stripped?: RecordedVersion['stripped'] | undefined;
}

function versionToPrepareOf({ source, stripped, putInPlaceBy }: VersionFound): VersionToPrepare {
  return { source, stripped, putInPlaceBy };
}

type RunVersionLedger = StreamReader & ProjectionReader;

function readModelReaderIn(ledger: RunVersionLedger, address: PlaybookAddress): ReadModelReader {
  return {
    ...prefixedReader(ledger, streamPrefixOfPlaybook(address)),
    ...playbookBoundProjectionReader(ledger, address),
  };
}

export function versionOfTheRun(
  ledger: RunVersionLedger,
  address: PlaybookAddress,
  version: DefinitionVersionAddress,
): Effect.Effect<VersionToPrepare | undefined> {
  return stagedRead({
    read: 'longest_run',
    reading: 'run_starts',
    definitionType: version.type,
    involved: [version.type],
    today: Effect.map(definitionVersionIn(ledger, address, version), (found) =>
      found === undefined ? undefined : versionToPrepareOf(found),
    ),
    fromTheReadModel: versionFromTheReadModelIn(
      readModelReaderIn(ledger, address),
      version.type,
      version.name,
      version.version,
    ).pipe(
      Effect.map((found): VersionToPrepare | undefined => versionToPrepareOf(found)),
      Effect.catchTag('not_found', () => Effect.undefined),
    ),
    answerOf: (found) => found,
    compared: (found, candidate) => Effect.succeed(comparisonOf(differingFieldsOf(found, candidate))),
  });
}
