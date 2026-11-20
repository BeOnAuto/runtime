import type { KeptContentHead, StreamedContent } from '@on.auto/content';
import { Context, Effect } from 'effect';

import { PlaybookContext, type PlaybookAddress } from '../caller/playbook-context.ts';
import type { HeldName } from '../definition-names/name-judgement.ts';
import type { TypedRejection } from '../outcome/typed-rejection.ts';
import { payloadReaderOf, type PayloadReader } from '../payloads/payload-reader.ts';
import { PayloadsShared } from '../payloads/shared-payloads.ts';
import type { BoundProjectionReader } from '../projections/keyed-projection.ts';
import type {
  PlaybookAppendedFactsReader,
  PlaybookRecordedReader,
  PlaybookRunOutcomesReader,
  StreamAges,
  StreamReader,
} from './stream-ports.ts';

export interface PlaybookContentReader {
  readonly readContent: (sha256: string) => Effect.Effect<StreamedContent | undefined>;
  readonly readContentHead: (sha256: string) => Effect.Effect<KeptContentHead | undefined>;
}

export interface PlaybookDefinitionsReader {
  readonly ofDefinition: (definition: string) => StreamReader & StreamAges & BoundProjectionReader;
  readonly holderOfName: (definitionType: string, name: string) => Effect.Effect<HeldName | undefined>;
  readonly nameHeldBy: (definition: string) => Effect.Effect<HeldName | undefined>;
  readonly namesHeldIn: (definitionType: string) => Effect.Effect<readonly HeldName[]>;
  readonly definitionHolding: (stream: string) => Effect.Effect<string | undefined>;
}

export class PlaybookReader extends Context.Service<
  PlaybookReader,
  StreamReader &
    StreamAges &
    PlaybookRecordedReader &
    PlaybookAppendedFactsReader &
    PlaybookRunOutcomesReader &
    BoundProjectionReader &
    PlaybookContentReader &
    PlaybookDefinitionsReader
>()('@on.auto/operations/PlaybookReader') {}

export interface AdmittedPlaybook {
  readonly address: PlaybookAddress;
  readonly reader: PlaybookReader['Service'];
}

export interface PlaybookAdmissions {
  readonly admitted: (playbook: string) => Effect.Effect<AdmittedPlaybook, TypedRejection>;
}

const admittedNowhere: PlaybookAdmissions = {
  admitted: (playbook) =>
    Effect.die(
      new Error(`A call the dispatcher did not admit is admitted to no other playbook, ${playbook} among them`),
    ),
};

export const PlaybookAdmission = Context.Reference<PlaybookAdmissions>('@on.auto/operations/PlaybookAdmission', {
  defaultValue: () => admittedNowhere,
});

export const playbookPayloadReader: Effect.Effect<PayloadReader, never, PlaybookReader | PlaybookContext> = Effect.gen(
  function* () {
    const { org, playbook } = yield* PlaybookContext;
    const { readContent, readContentHead } = yield* PlaybookReader;
    return payloadReaderOf({
      owner: { org, playbook },
      content: { get: (_owner, sha256) => readContent(sha256), getHead: (_owner, sha256) => readContentHead(sha256) },
      ...(yield* PayloadsShared),
    });
  },
);
