import {
  capabilityContract,
  type CancelledAttempt,
  type Capability,
  type CapabilityAnswer,
  type CapabilityRejection,
  type DefinitionSummary,
  type PlaybookOperation,
  type PreparedDefinition,
  type RunAttempt,
  type RunContext,
  type StrippedForms,
} from '@on.auto/definitions';
import type { InvalidInput, Notice, PlaybookAddress, Unavailable } from '@on.auto/operations';
import type { Effect, Schema } from 'effect';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  Change,
  ContractFour,
  ContractOne,
  ContractThree,
  ContractTwo,
  Row,
} from '../contract-testing/earlier-contracts.ts';
import type { CapabilityDatabase, CapabilityPorts, DueItem, DueWork, Folder, ProvidedCapability } from '../index.ts';

interface ContractFive extends Omit<ContractFour, 'prepared'> {
  readonly prepared: {
    readonly summary: DefinitionSummary;
    readonly check: (place: PlaybookAddress) => Effect.Effect<StrippedForms, InvalidInput | Unavailable>;
    readonly notices?: (place: PlaybookAddress) => Effect.Effect<readonly Notice[]>;
    readonly run: (input: Schema.Json, context: RunContext) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;
    readonly whenCancelled: 'stop' | 'finish';
    readonly cancelledAttempt: (attempt: RunAttempt) => CancelledAttempt;
    readonly callsTools: boolean;
    readonly finishesLaterFor: (input: Schema.Json) => boolean;
    readonly answersItsShapeFor: (input: Schema.Json) => boolean;
    readonly longestRunMs: number;
    readonly longestRunMsFor: (input: Schema.Json) => number;
    readonly resumesAfterMs: number;
  };
}

interface TypesOfEachContract {
  readonly 1: ContractOne;
  readonly 2: ContractTwo;
  readonly 3: ContractThree;
  readonly 4: ContractFour;
  readonly 5: ContractFive;
}

type ThisContract = TypesOfEachContract[typeof capabilityContract];

describe('the contract by which a capability is made and served', () => {
  it('holds the members and the types its version names, so that a change to either raises capabilityContract', () => {
    expectTypeOf<Capability>().toEqualTypeOf<ThisContract['capability']>();
    expectTypeOf<PreparedDefinition>().toEqualTypeOf<ThisContract['prepared']>();
    expectTypeOf<RunContext>().toEqualTypeOf<ThisContract['runContext']>();
    expectTypeOf<ProvidedCapability>().toEqualTypeOf<ThisContract['provided']>();
    expectTypeOf<CapabilityPorts>().toEqualTypeOf<ThisContract['ports']>();
    expectTypeOf<CapabilityDatabase>().toEqualTypeOf<ThisContract['database']>();
    expectTypeOf<Folder<Row, Change>>().toEqualTypeOf<ThisContract['folder']>();
    expectTypeOf<DueWork>().toEqualTypeOf<ThisContract['dueWork']>();
    expectTypeOf<DueItem>().toEqualTypeOf<ThisContract['dueItem']>();
    expectTypeOf<PlaybookOperation>().toEqualTypeOf<ThisContract['playbookOperation']>();
    expect(capabilityContract).toBe(5);
  });
});
