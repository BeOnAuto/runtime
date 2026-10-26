import type { Effect, Schema } from 'effect';

import type { OperationKind, OperationScope } from '../caller/operation-scope.ts';
import type { Permission } from '../caller/permission.ts';
import type { StreamedBytes, StreamedContent } from '../content/streamed-content.ts';
import type { DeclarableReason, Rejection } from '../outcome/rejection.ts';
import type { LinkToOpen, PlainLanguage } from '../plain-language/plain-language.ts';
import type { MethodOf, PathParameters, Route } from './route.ts';

export interface OfferedLink {
  readonly id: string;
  readonly url: string;
}

export interface AnswerAfterTheLink<Out, R extends DeclarableReason, Services> {
  readonly idOf: (output: Out) => string;
  readonly read: (link: OfferedLink) => Effect.Effect<Out, Rejection<R>, Services>;
}

interface ObjectValue {
  readonly [field: string]: unknown;
}

interface ReservedFieldsByScope {
  readonly org: { readonly org?: never };
  readonly playbook: { readonly org?: never; readonly playbook?: never };
}

export type RelativePath = `/${string}`;

export interface SuccessStatusByKind {
  readonly query: 200;
  readonly command: 200 | 201;
}

export type ObjectSchema<T extends ObjectValue = ObjectValue> = Schema.Constraint & {
  readonly Type: T;
  readonly DecodingServices: never;
  readonly EncodingServices: never;
};

export type InputSchemaFor<S extends OperationScope, P extends string> = ObjectSchema<
  ObjectValue & ReservedFieldsByScope[S] & { readonly [Parameter in PathParameters<P>]: string }
>;

export interface Definition<
  K extends OperationKind,
  P extends string,
  In extends ObjectSchema,
  Out extends ObjectSchema,
  R extends DeclarableReason,
  Services,
  ReadServices = never,
> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly route: Route<K, P>;
  readonly successStatus?: SuccessStatusByKind[K];
  readonly reachesOutside?: boolean;
  readonly mayChangeOutside?: boolean;
  readonly irreversible?: boolean;
  readonly repeatable?: boolean;
  readonly permittedBy?: readonly Permission[];
  readonly inputSchema: In;
  readonly outputSchema: Out;
  readonly reasons: readonly R[];
  readonly handle: (input: In['Type']) => Effect.Effect<Out['Type'], NoInfer<Rejection<R>>, Services>;
  readonly plainLanguage?: PlainLanguage<NoInfer<In['Type']>, NoInfer<Out['Type']>>;
  readonly linkToOpen?: (output: NoInfer<Out['Type']>) => LinkToOpen | undefined;
  readonly answerAfterTheLink?: AnswerAfterTheLink<NoInfer<Out['Type']>, NoInfer<R>, ReadServices>;
}

export type StreamedBodyKind = 'octet-stream' | 'csv';

export type BodyKind = 'json' | 'none' | StreamedBodyKind;

export interface StreamedBody {
  readonly kind: StreamedBodyKind;
  readonly mostBytes: number;
}

export type HttpBody = { readonly kind: 'json' } | { readonly kind: 'none' } | StreamedBody;

interface BodyKindsByRoute {
  readonly query: { readonly GET: 'none'; readonly POST: 'json' };
  readonly command: { readonly POST: BodyKind; readonly PUT: BodyKind; readonly DELETE: 'none' };
}

export type HttpBodyOf<K extends OperationKind, M extends MethodOf<K>> = Extract<
  HttpBody,
  { readonly kind: BodyKindsByRoute[K][M & keyof BodyKindsByRoute[K]] }
>;

export interface BodyArguments {
  readonly json: readonly [];
  readonly none: readonly [];
  readonly 'octet-stream': readonly [body: StreamedContent];
  readonly csv: readonly [body: StreamedContent];
}

export interface JsonAnswer<Out extends ObjectSchema> {
  readonly kind: 'json';
  readonly outputSchema: Out;
}

export interface StreamAnswer {
  readonly kind: 'stream';
  readonly mediaType: string;
}

export interface AnswerDeclarations<Out extends ObjectSchema> {
  readonly json: JsonAnswer<Out>;
  readonly stream: StreamAnswer;
}

export interface AnswerValues<Out extends ObjectSchema> {
  readonly json: Out['Type'];
  readonly stream: StreamedBytes;
}

export type AnswerKind = keyof AnswerDeclarations<ObjectSchema>;

type TheOneKindOf<A extends AnswerKind> = {
  readonly [Kind in AnswerKind]: [A] extends [Kind] ? Kind : never;
}[AnswerKind];

export type OfOneAnswerKind<A extends AnswerKind> = [TheOneKindOf<A>] extends [never]
  ? { readonly answer: never }
  : unknown;

export interface HttpFields<
  K extends OperationKind,
  M extends MethodOf<K>,
  P extends string,
  B extends HttpBody,
  In extends ObjectSchema,
  R extends DeclarableReason,
> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly route: Route<K, P, M>;
  readonly body: B;
  readonly successStatus?: SuccessStatusByKind[K];
  readonly permittedBy?: readonly Permission[];
  readonly inputSchema: In;
  readonly reasons: readonly R[];
}

export interface HttpHandlerOf<
  In extends ObjectSchema,
  B extends HttpBody,
  Answer,
  R extends DeclarableReason,
  Services,
> {
  readonly handle: (
    input: In['Type'],
    ...body: BodyArguments[B['kind']]
  ) => Effect.Effect<Answer, NoInfer<Rejection<R>>, Services>;
}

export interface HttpDefinition<
  K extends OperationKind,
  M extends MethodOf<K>,
  P extends string,
  B extends HttpBodyOf<K, M>,
  A extends AnswerKind,
  In extends ObjectSchema,
  Out extends ObjectSchema,
  R extends DeclarableReason,
  Services,
>
  extends
    HttpFields<K, M, P, B, In, R>,
    HttpHandlerOf<In, B, A extends 'json' ? Out['Type'] : StreamedBytes, R, Services> {
  readonly answer: (A extends 'json' ? JsonAnswer<Out> : StreamAnswer) & { readonly kind: A };
}
