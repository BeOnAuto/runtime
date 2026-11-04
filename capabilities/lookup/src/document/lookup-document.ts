import type { ValueContract } from '@on.auto/definitions/document';
import type { ParsedTemplate } from '@on.auto/definitions/template';
import type { CallBlock } from '@on.auto/definitions/tool-blocks';
import type { CompiledSchema } from '@on.auto/json-schema';

export interface WrittenText {
  readonly pointer: string;
  readonly template: ParsedTemplate;
}

export interface RunsBlock {
  readonly type: string;
  readonly name: string;
  readonly words?: WrittenText;
  readonly since?: WrittenText;
}

interface Described {
  readonly description?: string;
  readonly input: ValueContract;
}

export interface CallLookupDocument extends Described {
  readonly kind: 'call';
  readonly call: CallBlock;
  readonly callLine: number;
  readonly output: { readonly schema: CompiledSchema };
}

export interface RunsLookupDocument extends Described {
  readonly kind: 'runs';
  readonly runs: RunsBlock;
}

export type LookupFunctionDefinitionDocument = CallLookupDocument | RunsLookupDocument;
