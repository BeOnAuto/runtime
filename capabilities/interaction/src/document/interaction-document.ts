import type { ValueContract } from '@on.auto/definitions/document';
import type { ParsedTemplate } from '@on.auto/definitions/template';
import type { CallBlock } from '@on.auto/definitions/tool-blocks';
import type { CompiledSchema } from '@on.auto/json-schema';
import type { Schema } from 'effect';

import type { RenderTargetName } from '../rendering/render-targets.ts';
import type { ReplyRule } from '../replies/reply-rule.ts';
import type { WrittenRoute } from '../tool-blocks/compiled-tool-block.ts';

interface WrittenFunction {
  readonly description?: string;
  readonly input: ValueContract;
}

export interface CallDocument extends WrittenFunction {
  readonly shape: 'call';
  readonly call: CallBlock;
  readonly callLine: number;
  readonly output: { readonly schema: CompiledSchema };
}

interface HeldForAnAgent {
  readonly said: boolean;
  readonly line: number;
}

export interface RenderedBody {
  readonly target: RenderTargetName;
  readonly card: Schema.Json;
}

interface TextBody {
  readonly message: ParsedTemplate;
  readonly render?: undefined;
}

interface CardRequestBody {
  readonly render: RenderedBody;
}

export type RequestBody = TextBody | CardRequestBody;

interface RequestFields extends WrittenFunction {
  readonly shape: 'request';
  readonly output: ValueContract;
  readonly to: ParsedTemplate;
  readonly from?: ParsedTemplate;
  readonly expires: string;
  readonly expiresMs: number;
  readonly route?: WrittenRoute;
  readonly heldForAnAgent?: HeldForAnAgent;
  readonly repliesLine: number;
  readonly reply?: ReplyRule;
}

export type TextRequestDocument = RequestFields & TextBody;

export type RenderedRequestDocument = RequestFields & CardRequestBody;

export type RequestDocument = TextRequestDocument | RenderedRequestDocument;

export type InteractionFunctionDefinitionDocument = CallDocument | RequestDocument;
