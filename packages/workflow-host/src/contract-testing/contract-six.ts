import type { ContractFive } from './earlier-contracts.ts';

type CapabilityOfContractFive = ContractFive['capability'];

export interface ContractSix extends Omit<ContractFive, 'capability'> {
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
