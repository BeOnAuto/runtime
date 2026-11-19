import { Effect } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import type { Conflict } from '../outcome/conflict.ts';
import type { DeclarableReason, Rejection } from '../outcome/rejection.ts';
import { streamPrefixOfDefinition, wellFormed } from './bound-ports.ts';
import type { DecidedState, Recorded } from './decider.ts';
import type { Lineage } from './message-lineage.ts';
import type { MultiStreamWriter, StreamDecision } from './stream-ports.ts';

interface DefinitionDecision<State, Command, Event extends Recorded, R extends DeclarableReason> extends StreamDecision<
  State,
  Command,
  Event,
  R
> {
  readonly definition: string;
}

export interface DefinitionsWriter {
  readonly executeOnDefinitions: <State, Command, Event extends Recorded, R extends DeclarableReason>(
    decisions: readonly DefinitionDecision<State, Command, Event, R>[],
    lineage?: Lineage,
  ) => Effect.Effect<readonly DecidedState<State>[], Rejection<R> | Conflict>;
}

export function definitionsWriterOf(ledger: MultiStreamWriter, { org }: PlaybookAddress): DefinitionsWriter {
  return {
    executeOnDefinitions: <State, Command, Event extends Recorded, R extends DeclarableReason>(
      decisions: readonly DefinitionDecision<State, Command, Event, R>[],
      lineage?: Lineage,
    ) =>
      Effect.flatMap(
        Effect.forEach(decisions, ({ definition, stream, decider, command }) =>
          Effect.map(wellFormed(stream), (relative) => ({
            stream: `${streamPrefixOfDefinition({ org, definition })}${relative}`,
            decider,
            command,
          })),
        ),
        (prefixed: readonly StreamDecision<State, Command, Event, R>[]) => ledger.executeMultiStream(prefixed, lineage),
      ),
  };
}
