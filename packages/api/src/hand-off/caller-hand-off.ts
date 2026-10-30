import type { AuthInfo } from '@modelcontextprotocol/server';
import { PlaybookIdSchema, CallerIdentitySchema, type CallerIdentity } from '@on.auto/operations';
import { Context, Schema } from 'effect';

import { TraceParentSchema, type TraceParent } from '../tracing/trace-parent.ts';
import { DroppedArgumentSchema, type DroppedArgument } from './dropped-arguments.ts';

export interface OrgCall {
  readonly caller: CallerIdentity;
  readonly org: string;
  readonly requestId: string;
  readonly trace?: TraceParent;
  readonly dropped: readonly DroppedArgument[];
  readonly context: Context.Context<never>;
}

export interface PlaybookCall extends OrgCall {
  readonly playbook: string;
}

export interface HandedOff {
  readonly authInfo?: { readonly extra?: Readonly<Record<string, unknown>> | undefined } | undefined;
}

const placeholderToken = 'verified-by-auto-runtime';

const OrgCallSchema = Schema.Struct({
  caller: CallerIdentitySchema,
  org: Schema.String,
  requestId: Schema.String,
  trace: Schema.optionalKey(TraceParentSchema),
  dropped: Schema.Array(DroppedArgumentSchema),
});

const PlaybookCallSchema = Schema.Struct({ ...OrgCallSchema.fields, playbook: PlaybookIdSchema });

const ContextOfTheCall = Schema.Struct({
  context: Schema.declare((value: unknown): value is Context.Context<never> => Context.isContext(value)),
});

const decodeContextOfTheCall = Schema.decodeUnknownSync(ContextOfTheCall);

const decodeOrgCall = Schema.decodeUnknownSync(OrgCallSchema);

const decodePlaybookCall = Schema.decodeUnknownSync(PlaybookCallSchema);

export function tracedBy(trace: TraceParent | undefined): { readonly trace?: TraceParent } {
  return trace === undefined ? {} : { trace };
}

export function authInfoFor(call: OrgCall | PlaybookCall): AuthInfo {
  return {
    token: placeholderToken,
    clientId: call.caller.id,
    scopes: [...call.caller.permissions],
    extra: { ...call },
  };
}

export function orgCallOf({ authInfo }: HandedOff): OrgCall {
  return { ...decodeOrgCall(authInfo?.extra), ...decodeContextOfTheCall(authInfo?.extra) };
}

export function playbookCallOf({ authInfo }: HandedOff): PlaybookCall {
  return { ...decodePlaybookCall(authInfo?.extra), ...decodeContextOfTheCall(authInfo?.extra) };
}
