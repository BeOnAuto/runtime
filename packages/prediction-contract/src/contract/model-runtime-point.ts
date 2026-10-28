export const modelRuntimePoint = 'prediction/model-runtime';

export const modelRuntimeContract = 1;

export interface ContractRange {
  readonly least: number;
  readonly most: number;
}

export const acceptedModelRuntimeContracts: ContractRange = { least: 1, most: modelRuntimeContract };
