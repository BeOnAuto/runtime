import { Conflict, streamPrefixOfPlaybook, type PlaybookAddress, type Ledger, type Lineage } from '@on.auto/operations';
import { Effect, Option, Result, Schema, SchemaIssue } from 'effect';

import { jsonBytesOf } from '../runs/recorded-size.ts';
import { CloudEventSchema, mostPublishedEventBytes, type CloudEvent } from './cloud-event.ts';
import { publishedEventDecider, publishedEventStreamOf, type Emitter } from './published-events.ts';
import type { PlaybookOwnNames } from './reserved-attributes.ts';

export interface Emission {
  readonly event: Schema.Json;
  readonly emitter: Emitter;
  readonly depth: number;
  readonly by: string;
  readonly at: string;
}

export type EmitOutcome = 'recorded' | 'already_recorded' | 'refused';

export type EmitEvent = (
  playbook: PlaybookAddress,
  emission: Emission,
  lineage: Lineage,
) => Effect.Effect<EmitOutcome, Conflict>;

export interface EmittedEvents {
  readonly eventOf: (event: Schema.Json) => CloudEvent | undefined;
  readonly refusalOf: (event: Schema.Json) => string | undefined;
}

const formatIssues = SchemaIssue.makeFormatterDefault();

export function emittedEventsOf({ refusingThePlaybooksOwnAttributes }: PlaybookOwnNames): EmittedEvents {
  const EmittedEventSchema = CloudEventSchema.check(refusingThePlaybooksOwnAttributes);
  const decodeEvent = Schema.decodeUnknownOption(EmittedEventSchema);
  const decodeEmitted = Schema.decodeUnknownResult(EmittedEventSchema);
  return {
    eventOf: (event) =>
      Option.getOrUndefined(
        Option.filter(decodeEvent(event), (decoded) => jsonBytesOf(decoded) <= mostPublishedEventBytes),
      ),
    refusalOf: (event) =>
      Option.getOrUndefined(
        Option.map(Result.getFailure(decodeEmitted(event)), ({ issue }: { readonly issue: SchemaIssue.Issue }) =>
          formatIssues(issue)
            .replaceAll(/\n\s+at \["?([^"\]]*)"?\]/gu, ' (at $1)')
            .replaceAll('\n', '; '),
        ),
      ),
  };
}

function refusedUnlessChanging({ detail, kind }: Readonly<Pick<Conflict, 'detail' | 'kind'>>) {
  return kind === 'concurrent_change'
    ? Effect.fail(new Conflict({ detail, kind }))
    : Effect.succeed<EmitOutcome>('refused');
}

export function eventEmitter(ledger: Ledger['Service'], names: PlaybookOwnNames): EmitEvent {
  const { eventOf } = emittedEventsOf(names);
  return (playbook, { event, emitter, depth, by, at }, lineage) => {
    const cloudEvent = eventOf(event);
    if (cloudEvent === undefined) {
      return Effect.succeed('refused');
    }
    const stream = `${streamPrefixOfPlaybook(playbook)}${publishedEventStreamOf(cloudEvent.source, cloudEvent.id)}`;
    const publication = { event: cloudEvent, filled: [], emittedBy: emitter, depth, by, at };
    return ledger.execute(stream, publishedEventDecider, publication, lineage).pipe(
      Effect.map(({ state }): EmitOutcome => (state?.context.at === at ? 'recorded' : 'already_recorded')),
      Effect.catchTag('conflict', refusedUnlessChanging),
    );
  };
}
