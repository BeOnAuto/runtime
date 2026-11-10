import type { ContentHeads } from '@on.auto/content';
import { Effect, type SchemaAST } from 'effect';

import { contentHoldersOf, type ContentHolders } from '../held-content/content-declaration.ts';
import { payloadsNamed } from '../held-content/held-digests.ts';
import { streamPrefixOfPlaybook } from '../ledger/bound-ports.ts';
import type { TypedEvent } from '../ledger/decider.ts';
import { addressedStreamOf } from '../projections/keyed-projection.ts';
import type { AppendedFact } from '../projections/memory-projections.ts';

function payloadBytesNamed(holders: ContentHolders, { type, data }: TypedEvent): number | undefined {
  const declaration = holders.get(type);
  const named = declaration === undefined ? [] : payloadsNamed(data, declaration);
  return named.length === 0 ? undefined : named.reduce((total, { bytes }) => total + bytes, 0);
}

export function measuredBy(schema: { readonly ast: SchemaAST.AST }): (fact: AppendedFact) => AppendedFact {
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
      head === undefined
        ? Effect.die(
            new Error(
              `A fact names the payload ${sha256} of ${streamPrefixOfPlaybook(playbook)}, which the playbook's content does not keep; a payload is put before the fact that names it is appended`,
            ),
          )
        : Effect.void,
    ),
  ).pipe(Effect.asVoid);
}
