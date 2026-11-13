import type { ContentHeads } from '@on.auto/content';
import { Effect, Schema, type SchemaAST } from 'effect';

import { contentHoldersOf, type ContentHolders } from '../held-content/content-declaration.ts';
import { payloadsNamed } from '../held-content/held-digests.ts';
import { streamPrefixOfPlaybook } from '../ledger/bound-ports.ts';
import type { Context } from '../ledger/context.ts';
import type { Fold, Recorded, StreamState, TypedEvent } from '../ledger/decider.ts';
import { addressedStreamOf } from '../projections/keyed-projection.ts';
import type { AppendedFact } from '../projections/memory-projections.ts';

function payloadBytesNamed(holders: ContentHolders, { type, data }: TypedEvent): number | undefined {
  const declaration = holders.get(type);
  const named = declaration === undefined ? [] : payloadsNamed(data, declaration);
  return named.length === 0 ? undefined : named.reduce((total, { bytes }) => total + bytes, 0);
}

function measuredBy(schema: { readonly ast: SchemaAST.AST }): (fact: AppendedFact) => AppendedFact {
  const declared = contentHoldersOf([schema]);
  return ({ type, data, context }) => {
    const payloadBytes = payloadBytesNamed(declared, { type, data });
    return payloadBytes === undefined ? { type, data, context } : { type, data, context, payloadBytes };
  };
}

function bytesOf(payloadBytes: number | undefined): number {
  return payloadBytes ?? 0;
}

export function requireHeldAsMeasured(holders: ContentHolders, stream: string, facts: readonly AppendedFact[]): void {
  for (const fact of facts) {
    const held = payloadBytesNamed(holders, fact);
    if (held !== fact.payloadBytes) {
      throw new Error(
        `A fact ${fact.type} of ${stream} keeps ${bytesOf(fact.payloadBytes)} bytes of payloads outside by its schema, where the ledger's holders count ${bytesOf(held)}, so the ledger would not hold them; the ledger must be opened with the schema of every fact that keeps a payload`,
      );
    }
  }
}

export function payloadsHeaded(
  heads: ContentHeads,
  holders: ContentHolders,
  stream: string,
  facts: readonly AppendedFact[],
): Effect.Effect<void> {
  const address = addressedStreamOf(stream)?.address;
  if (address?.playbook === undefined) {
    return Effect.void;
  }
  const playbook = { org: address.org, playbook: address.playbook };
  const digests = facts.flatMap(({ type, data }) => {
    const declaration = holders.get(type);
    return declaration === undefined ? [] : payloadsNamed(data, declaration).map(({ sha256 }) => sha256);
  });
  return Effect.forEach(digests, (sha256) =>
    Effect.flatMap(heads.read(playbook, sha256), (head) =>
      head === undefined || head.erasedAt !== undefined
        ? Effect.die(
            new Error(
              `A fact names the payload ${sha256} of ${streamPrefixOfPlaybook(playbook)}, which the playbook's content does not keep; a payload is put before the fact that names it is appended`,
            ),
          )
        : Effect.void,
    ),
  ).pipe(Effect.asVoid);
}

const EncodedFactSchema = Schema.Struct({ type: Schema.String, data: Schema.Unknown });

const encodedFactOf = Schema.decodeUnknownSync(EncodedFactSchema);

export function folded<State, Event extends Recorded>(
  fold: Fold<State, Event>,
  stored: readonly AppendedFact[],
): Effect.Effect<StreamState<State>> {
  const decodeEvent = Schema.decodeUnknownEffect(Schema.toCodecJson(fold.eventSchema));
  return Effect.forEach(stored, ({ type, data, context }) => Effect.orDie(decodeEvent({ type, data, context }))).pipe(
    Effect.map((events: readonly Event[]) => ({
      state: foldedOver(fold, fold.initialState, events),
      version: events.length,
    })),
  );
}

export function foldedOver<State, Event extends Recorded>(
  fold: Fold<State, Event>,
  from: State,
  events: readonly Event[],
): State {
  let state = from;
  for (const event of events) {
    state = fold.evolve(state, event);
  }
  return state;
}

export function encodedWith<Event extends Recorded>(
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
  context: Context,
): (event: Event) => Effect.Effect<AppendedFact> {
  const encodeEvent = Schema.encodeUnknownEffect(Schema.toCodecJson(eventSchema));
  const measured = measuredBy(eventSchema);
  return (event) =>
    Effect.orDie(encodeEvent(event)).pipe(
      Effect.map((encoded) => {
        const { type, data } = encodedFactOf(encoded);
        return measured({ type, data, context });
      }),
    );
}
