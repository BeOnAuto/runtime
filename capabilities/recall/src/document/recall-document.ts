import type { FilterExpression, ValueContract } from '@on.auto/definitions/document';
import type { ViewDetails } from '@on.auto/workflow-host';

export interface RecallFunctionDefinitionDocument {
  readonly description?: string;
  readonly language: 'typescript';
  readonly input: ValueContract;
  readonly output: ValueContract;
  readonly answers: boolean;
  readonly filterExpressions: readonly FilterExpression[];
  readonly details: ViewDetails;
}
