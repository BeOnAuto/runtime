import type { Digested } from '@on.auto/content';
import { JsonPointer as Pointers, Record, Schema } from 'effect';

import { keptPayloadAnnotation, type JsonPointer, type PayloadPointers } from '../held-content/content-declaration.ts';
import { mostShownFieldBytes } from '../reading/public-event.ts';

export const mostInlinePayloadBytes = mostShownFieldBytes;

export const PayloadDigestSchema = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/u, { expected: 'a SHA-256 in 64 lowercase hex digits' }),
).annotate({ description: "The SHA-256 of the value's text, under which the playbook's content keeps it" });

export const PayloadBytesSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
  description: "The size of the value's text, in bytes of UTF-8",
});

export type Payload<Value> = { readonly inline: Value } | { readonly kept: Digested };

export type DigestName<Name extends string> = `${Name}_sha256`;

export type BytesName<Name extends string> = `${Name}_bytes`;

export type PayloadFields<Name extends string, Value extends Schema.Top> = {
  readonly [Inline in Name]: Schema.optionalKey<Value>;
} & {
  readonly [Digest in DigestName<Name>]: Schema.optionalKey<typeof PayloadDigestSchema>;
} & {
  readonly [Bytes in BytesName<Name>]: Schema.optionalKey<typeof PayloadBytesSchema>;
};

type InlineMember<Name extends string, Value> = { readonly [Inline in Name]?: Value };

type DigestMember<Name extends string> = { readonly [Digest in DigestName<Name>]?: string };

type BytesMember<Name extends string> = { readonly [Bytes in BytesName<Name>]?: number };

export type PayloadMembers<Name extends string, Value> = InlineMember<Name, Value> &
  DigestMember<Name> &
  BytesMember<Name>;

export type PayloadArm<Name extends string, Value> =
  | { readonly [Inline in Name]: Value }
  | ({ readonly [Digest in DigestName<Name>]: string } & { readonly [Bytes in BytesName<Name>]: number });

export type PayloadNameOf<Data> = {
  readonly [Name in keyof Data & string]: DigestName<Name> extends keyof Data ? Name : never;
}[keyof Data & string];

export function digestNameOf<const Name extends string>(name: Name): DigestName<Name> {
  return `${name}_sha256`;
}

export function bytesNameOf<const Name extends string>(name: Name): BytesName<Name> {
  return `${name}_bytes`;
}

export function payloadFields<const Name extends string, Value extends Schema.Top>(
  name: Name,
  value: Value,
): PayloadFields<Name, Value> {
  const digestOfThePayload = PayloadDigestSchema.annotate({ [keptPayloadAnnotation]: name });
  return {
    ...Record.singleton(name, Schema.optionalKey(value)),
    ...Record.singleton(digestNameOf(name), Schema.optionalKey(digestOfThePayload)),
    ...Record.singleton(bytesNameOf(name), Schema.optionalKey(PayloadBytesSchema)),
  };
}

function pointerTo(within: JsonPointer | '', member: string): JsonPointer {
  const token = Pointers.escapeToken(member);
  return within === '' ? `/${token}` : `${within}/${token}`;
}

export function payloadPointersOf(name: string, within: JsonPointer | '' = ''): PayloadPointers {
  return { sha256: pointerTo(within, digestNameOf(name)), bytes: pointerTo(within, bytesNameOf(name)) };
}

interface Arms {
  readonly inline: boolean;
  readonly digest: boolean;
  readonly bytes: boolean;
}

function armsOf(data: object, name: string): Arms {
  return {
    inline: Object.hasOwn(data, name),
    digest: Object.hasOwn(data, digestNameOf(name)),
    bytes: Object.hasOwn(data, bytesNameOf(name)),
  };
}

interface ArmIssue {
  readonly path: readonly [string];
  readonly issue: string;
}

function armIssuesOf(data: object, name: string, mayBeAbsent: boolean): readonly ArmIssue[] {
  const { inline, digest, bytes } = armsOf(data, name);
  const [digestName, bytesName] = [digestNameOf(name), bytesNameOf(name)];
  if (digest !== bytes) {
    return [{ path: [digest ? bytesName : digestName], issue: `Expected ${digestName} and ${bytesName} together` }];
  }
  if (inline && digest) {
    return [{ path: [name], issue: `Expected ${name}, or ${digestName} and ${bytesName}, and not both` }];
  }
  return inline || digest || mayBeAbsent
    ? []
    : [{ path: [name], issue: `Expected ${name}, or ${digestName} and ${bytesName}` }];
}

type HeldValueOf<Data, Name extends keyof Data> = Exclude<Data[Name], undefined>;

type HeldArms<Data, Held extends readonly (keyof Data & string)[]> = Held extends readonly [
  infer Name extends keyof Data & string,
  ...infer Rest extends readonly (keyof Data & string)[],
]
  ? PayloadArm<Name, HeldValueOf<Data, Name>> & HeldArms<Data, Rest>
  : unknown;

type OfObjects = Schema.Top & { readonly Type: object; readonly Rebuild: { readonly Type: object } };

export function withPayloads<Data extends OfObjects, const Held extends readonly PayloadNameOf<Data['Type']>[]>(
  data: Data,
  held: Held,
  mayBeAbsent: readonly PayloadNameOf<Data['Type']>[] = [],
) {
  const issuesOf = (value: object) => [
    ...held.flatMap((name) => armIssuesOf(value, name, false)),
    ...mayBeAbsent.flatMap((name) => armIssuesOf(value, name, true)),
  ];
  type Checked = Data['Rebuild']['Type'];
  const holdsItsArms = (value: Checked): value is Checked & HeldArms<Data['Type'], Held> =>
    issuesOf(value).length === 0;
  const checked = data.check(Schema.makeFilter(issuesOf, undefined, true));
  return Schema.refine<Data['Rebuild'], Checked & HeldArms<Data['Type'], Held>>(holdsItsArms)(checked);
}

function memberOf<const Name extends string, Value>(
  data: { readonly [Named in Name]?: Value },
  name: Name,
): Value | undefined {
  return data[name];
}

export function payloadIfAny<const Name extends string, Value>(
  data: PayloadMembers<Name, Value>,
  name: Name,
): Payload<Value> | undefined {
  const inline = memberOf<Name, Value>(data, name);
  const sha256 = memberOf<DigestName<Name>, string>(data, digestNameOf(name));
  const bytes = memberOf<BytesName<Name>, number>(data, bytesNameOf(name));
  if (inline !== undefined) {
    return { inline };
  }
  return sha256 === undefined || bytes === undefined ? undefined : { kept: { sha256, bytes } };
}

export function payloadOf<const Name extends string, Value>(
  data: PayloadMembers<Name, Value>,
  name: Name,
): Payload<Value> {
  const payload = payloadIfAny(data, name);
  if (payload === undefined) {
    throw new Error(
      `The data holds neither ${name} nor ${digestNameOf(name)} and ${bytesNameOf(name)}, which the schema of a fact that keeps the payload refuses`,
    );
  }
  return payload;
}

export function inputPayloadOf<Value>({ data }: { readonly data: PayloadArm<'input', Value> }): Payload<Value> {
  return payloadOf(data, 'input');
}

export function outputPayloadOf<Value>({ data }: { readonly data: PayloadArm<'output', Value> }): Payload<Value> {
  return payloadOf(data, 'output');
}

export function answerPayloadOf<Value>({ data }: { readonly data: PayloadArm<'answer', Value> }): Payload<Value> {
  return payloadOf(data, 'answer');
}

export function payloadMembers<const Name extends string, Value>(
  name: Name,
  payload: Payload<Value>,
): PayloadArm<Name, Value> {
  if ('inline' in payload) {
    return Record.singleton(name, payload.inline);
  }
  return {
    ...Record.singleton(digestNameOf(name), payload.kept.sha256),
    ...Record.singleton(bytesNameOf(name), payload.kept.bytes),
  };
}
