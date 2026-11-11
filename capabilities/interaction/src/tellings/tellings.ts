import { textAt } from '@on.auto/definitions/tool-blocks';
import {
  playbookCallerOf,
  messageIdOf,
  randomUUIDv7,
  streamPrefixOfPlaybook,
  type PlaybookAddress,
  type Lineage,
  type StreamWriter,
} from '@on.auto/operations';
import {
  answerDocument,
  conversationCallDecider,
  conversationCallStreamOf,
  tellingEndedOf,
  tellingStartedOf,
  type CalledOnce,
  type DefinitionOfTheTelling,
  type ToldAs,
  type ToolAccess,
} from '@on.auto/tool-servers';
import { conversationCallIdKey } from '@on.auto/tool-servers/policy';
import { DateTime, Effect } from 'effect';

import { isBoundedPart } from '../delivery/sent-messages.ts';
import type { TellingCall } from './telling-calls.ts';

export interface Telling {
  readonly playbook: PlaybookAddress;
  readonly server: string;
  readonly runId: string;
  readonly definition: DefinitionOfTheTelling;
  readonly lineage: Lineage;
  readonly conversation: string;
  readonly call: TellingCall;
}

export interface TellingParts {
  readonly ledger: StreamWriter;
  readonly tools: Pick<ToolAccess, 'preparedCall'>;
}

const moment = Effect.map(DateTime.now, DateTime.formatIso);

function partOf(document: unknown, pointer: string): string | undefined {
  const part = textAt(document, pointer);
  return part !== undefined && isBoundedPart(part) ? part : undefined;
}

function toldAsOf({ conversation: ofTheRequest, call }: Telling, called: CalledOnce): ToldAs | undefined {
  if (call.idAt === undefined || called.kind !== 'answered' || called.outcome !== 'result') {
    return undefined;
  }
  const document = answerDocument(called.answer);
  const id = partOf(document, call.idAt);
  const conversation = call.conversationAt === undefined ? ofTheRequest : partOf(document, call.conversationAt);
  return id === undefined || conversation === undefined ? undefined : { conversation, id };
}

export function onceFor({ runId, call }: Pick<Telling, 'runId' | 'call'>): string {
  return `${runId}-${call.about}-${call.form}`;
}

export function told({ ledger, tools }: TellingParts, telling: Telling, callId = randomUUIDv7()): Effect.Effect<void> {
  const { playbook, server, runId, definition, call: made, lineage } = telling;
  const stream = `${streamPrefixOfPlaybook(playbook)}${conversationCallStreamOf(callId)}`;
  const by = playbookCallerOf(playbook).id;
  const ofTheCall = { callId, runId, definition, about: made.about, form: made.form };
  const call = {
    ...playbook,
    reference: { server, tool: made.tool },
    input: made.input,
    meta: { [conversationCallIdKey]: callId },
  };
  return Effect.gen(function* () {
    const { fields, called: calling } = yield* tools.preparedCall(call);
    const started = tellingStartedOf(ofTheCall, fields, { by, at: yield* moment });
    const version = yield* ledger.execute(stream, conversationCallDecider, started, lineage).pipe(
      Effect.map((start) => start.version),
      Effect.catchTag('conflict', () => Effect.undefined),
      Effect.orDie,
    );
    if (version === undefined) {
      return;
    }
    const called = yield* calling;
    const ended = tellingEndedOf(ofTheCall, called, { by, at: yield* moment }, toldAsOf(telling, called));
    yield* ledger
      .execute(stream, conversationCallDecider, ended, { ...lineage, causationId: messageIdOf(stream, version) })
      .pipe(Effect.orDie);
  });
}
