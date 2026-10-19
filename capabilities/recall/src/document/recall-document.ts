import type { ValueContract } from '@on.auto/definitions/document';
import type { ViewDetails } from '@on.auto/workflow-host';

export interface FilterExpression {
  readonly source: string;
  readonly pointer: string;
  readonly line: number;
}

export interface RecallFunctionDefinitionDocument {
  readonly description?: string;
  readonly about?: string;
  readonly language: 'typescript';
  readonly input: ValueContract;
  readonly output: ValueContract;
  readonly answers: boolean;
  readonly filterExpressions: readonly FilterExpression[];
  readonly details: ViewDetails;
}
