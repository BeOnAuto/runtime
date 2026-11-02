import type { ValueContract } from '@on.auto/definitions/document';
import type { CallBlock } from '@on.auto/definitions/tool-blocks';
import type { CompiledSchema } from '@on.auto/json-schema';

export interface LookupFunctionDefinitionDocument {
  readonly description?: string;
  readonly call: CallBlock;
  readonly callLine: number;
  readonly input: ValueContract;
  readonly output: { readonly schema: CompiledSchema };
}
