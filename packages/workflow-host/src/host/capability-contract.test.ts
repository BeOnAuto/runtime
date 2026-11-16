import {
  capabilityContract,
  type Capability,
  type PlaybookOperation,
  type PreparedDefinition,
  type RunContext,
} from '@on.auto/definitions';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  Change,
  ContractFive,
  ContractFour,
  ContractOne,
  ContractThree,
  ContractTwo,
  Row,
} from '../contract-testing/earlier-contracts.ts';
import type { CapabilityDatabase, CapabilityPorts, DueItem, DueWork, Folder, ProvidedCapability } from '../index.ts';

type CapabilityOfContractFive = ContractFive['capability'];

interface ContractSix extends Omit<ContractFive, 'capability'> {
  readonly capability: {
    readonly type: CapabilityOfContractFive['type'];
    readonly title: CapabilityOfContractFive['title'];
    readonly guide: {
      readonly name: string;
      readonly onThisServer?: string;
      readonly variables?: Readonly<Record<string, { readonly value: string; readonly default: string }>>;
    };
    readonly noun: CapabilityOfContractFive['noun'];
    readonly describeOutput: CapabilityOfContractFive['describeOutput'];
    readonly mediaType: CapabilityOfContractFive['mediaType'];
    readonly longestAnyRunMs: CapabilityOfContractFive['longestAnyRunMs'];
    readonly reachesOutside: CapabilityOfContractFive['reachesOutside'];
    readonly mayChangeOutside: CapabilityOfContractFive['mayChangeOutside'];
    readonly outsideTheDirectoryListing?: true;
    readonly mostActive: CapabilityOfContractFive['mostActive'];
    readonly standing: CapabilityOfContractFive['standing'];
    readonly cancel: CapabilityOfContractFive['cancel'];
    readonly runWords: CapabilityOfContractFive['runWords'];
    readonly facts: CapabilityOfContractFive['facts'];
    readonly resumes: CapabilityOfContractFive['resumes'];
    readonly prepare: CapabilityOfContractFive['prepare'];
  };
}

interface TypesOfEachContract {
  readonly 1: ContractOne;
  readonly 2: ContractTwo;
  readonly 3: ContractThree;
  readonly 4: ContractFour;
  readonly 5: ContractFive;
  readonly 6: ContractSix;
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
    expect(capabilityContract).toBe(6);
  });
});
