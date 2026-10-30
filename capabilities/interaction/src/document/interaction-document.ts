import type { ValueContract } from '@on.auto/definitions/document';
import type { ParsedTemplate } from '@on.auto/definitions/template';
import type { CompiledSchema } from '@on.auto/json-schema';

import type { ReplyRule } from '../replies/reply-rule.ts';
import type { WrittenRoute } from '../tool-blocks/compiled-tool-block.ts';
import type { CallBlock } from '../tool-blocks/tool-block-schemas.ts';

interface WrittenFunction {
  readonly description?: string;
  readonly input: ValueContract;
}

export interface CallDocument extends WrittenFunction {
  readonly shape: 'call';
  readonly call: CallBlock;
  readonly output: { readonly schema: CompiledSchema };
}

export interface RequestDocument extends WrittenFunction {
  readonly shape: 'request';
  readonly output: ValueContract;
  readonly to: ParsedTemplate;
  readonly from?: ParsedTemplate;
  readonly expires: string;
  readonly expiresMs: number;
  readonly message: ParsedTemplate;
  readonly route?: WrittenRoute;
  readonly reply?: ReplyRule;
}

export type InteractionFunctionDefinitionDocument = CallDocument | RequestDocument;
