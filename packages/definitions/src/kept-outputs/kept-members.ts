import { Buffer } from 'node:buffer';

import { utf8Carries } from '@on.auto/operations/payloads';
import { declaredAt } from '@on.auto/tool-servers';
import { JsonPointer, type Schema } from 'effect';

import { jsonBytesOf, mostResultBytes } from '../runs/recorded-size.ts';

export interface MemberToKeep {
  readonly pointer: string;
  readonly value: Schema.Json;
  readonly mediaType: string;
  readonly bytes: number;
}

interface Member {
  readonly pointer: string;
  readonly value: Schema.Json;
  readonly jsonBytes: number;
}

type Container = Schema.JsonArray | Schema.JsonObject;

type Entry = readonly [string, Schema.Json];

export type KeptPlan =
  | { readonly kept: 'nothing' }
  | { readonly kept: 'whole'; readonly whole: MemberToKeep }
  | { readonly kept: 'members'; readonly of: Container; readonly members: readonly MemberToKeep[] };

const keptNothing: KeptPlan = { kept: 'nothing' };

export const leastKeptMemberBytes = mostResultBytes / 4;

const jsonMediaType = 'application/json';

const plainText = 'text/plain';

const uuidCharacters = 36;

const sha256Characters = 64;

function essenceOf(mediaType: string): string {
  return mediaType.split(';', 1).join('').trim().toLowerCase();
}

function textMediaTypeAt(schema: Schema.JsonObject | undefined, pointer: string): string {
  const declared =
    schema === undefined ? [] : [...declaredAt(schema, pointer).mediaTypes].map((mediaType) => essenceOf(mediaType));
  const [only] = declared;
  const essence = declared.length === 1 && only !== undefined && only.startsWith('text/') ? only : plainText;
  return `${essence}; charset=utf-8`;
}

function wellFormed(text: string): string {
  return utf8Carries(text) ? text : text.toWellFormed();
}

export function textOf({ value }: Pick<MemberToKeep, 'value'>): string {
  return typeof value === 'string' ? wellFormed(value) : JSON.stringify(value);
}

function toKeepOf({ pointer, value, jsonBytes }: Member, schema: Schema.JsonObject | undefined): MemberToKeep {
  return typeof value === 'string'
    ? { pointer, value, mediaType: textMediaTypeAt(schema, pointer), bytes: Buffer.byteLength(value, 'utf8') }
    : { pointer, value, mediaType: jsonMediaType, bytes: jsonBytes };
}

export function referenceBytesOf({ mediaType, bytes }: Pick<MemberToKeep, 'mediaType' | 'bytes'>): number {
  return jsonBytesOf({
    id: '0'.repeat(uuidCharacters),
    media_type: mediaType,
    bytes,
    sha256: '0'.repeat(sha256Characters),
    address: null,
    address_until: null,
  });
}

function memberOf(pointer: string, value: Schema.Json): Member {
  return { pointer, value, jsonBytes: jsonBytesOf(value) };
}

function ownMembersOf(output: Container): readonly Member[] {
  return Array.isArray(output)
    ? output.map((value: Schema.Json, index) => memberOf(`/${index}`, value))
    : Object.entries(output)
        .toSorted(([one]: Entry, [other]: Entry) => (one < other ? -1 : 1))
        .map(([key, value]: Entry) => memberOf(`/${JsonPointer.escapeToken(key)}`, value));
}

function largestFirst(members: readonly Member[]): readonly Member[] {
  return members.toSorted((one, other) => other.jsonBytes - one.jsonBytes);
}

function keptUntilItFits(
  members: readonly Member[],
  outputBytes: number,
  room: number,
  schema: Schema.JsonObject | undefined,
): readonly MemberToKeep[] | undefined {
  const kept: MemberToKeep[] = [];
  let left = outputBytes;
  for (const member of largestFirst(members)) {
    if (left <= room) {
      break;
    }
    const toKeep = toKeepOf(member, schema);
    left += referenceBytesOf(toKeep) - member.jsonBytes;
    kept.push(toKeep);
  }
  return left <= room ? kept : undefined;
}

function membersOf(
  output: Container,
  outputBytes: number,
  room: number,
  schema: Schema.JsonObject | undefined,
): readonly MemberToKeep[] | undefined {
  const candidates = ownMembersOf(output).filter(({ jsonBytes }) => jsonBytes >= leastKeptMemberBytes);
  return keptUntilItFits(candidates, outputBytes, room, schema);
}

export function keptPlanOf(output: Schema.Json, room: number, schema: Schema.JsonObject | undefined): KeptPlan {
  const outputBytes = jsonBytesOf(output);
  if (outputBytes <= room) {
    return keptNothing;
  }
  if (typeof output === 'object' && output !== null) {
    const members = membersOf(output, outputBytes, room, schema);
    if (members !== undefined) {
      return { kept: 'members', of: output, members };
    }
  }
  const whole = toKeepOf({ pointer: '', value: output, jsonBytes: outputBytes }, schema);
  return referenceBytesOf(whole) <= room ? { kept: 'whole', whole } : keptNothing;
}
