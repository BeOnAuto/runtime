import { Buffer } from 'node:buffer';

import type { KeptContent } from '@on.auto/operations';
import { answerPayloadOf, inputPayloadOf, outputPayloadOf, type Payload } from '@on.auto/operations/payloads';
import { Option, Schema } from 'effect';

import type { RecordedRunFact } from '../runs/run-events.ts';

const mostIssuesShown = 5;

const mostIssueDetailBytes = 256;

const mostPointerBytes = 128;

export const mostDetailBytes = 1024;

export const mostDescriptionCharacters = 300;

export const mostNameBytes = 256;

export interface ShownIssue {
  readonly detail: string;
  readonly pointer: string;
}

function encodedBytesOf(character: string): number {
  return Buffer.byteLength(JSON.stringify(character), 'utf8') - 2;
}

export function cutAtCodePoint(text: string, mostBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    bytes += encodedBytesOf(character);
    if (bytes > mostBytes) {
      return text.slice(0, end);
    }
    end += character.length;
  }
  return text;
}

export function issuesShown(issues: readonly ShownIssue[]) {
  return {
    issue_count: issues.length,
    issues: issues.slice(0, mostIssuesShown).map(({ detail, pointer }) => ({
      detail: cutAtCodePoint(detail, mostIssueDetailBytes),
      pointer: cutAtCodePoint(pointer, mostPointerBytes),
    })),
  };
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

type PayloadShown = Readonly<Record<string, Schema.Json>>;

function payloadShownOf(name: string, payload: Payload<Schema.Json>, content: KeptContent): PayloadShown {
  if ('inline' in payload) {
    return { [name]: payload.inline };
  }
  const { sha256, bytes } = payload.kept;
  const members = { [`${name}_sha256`]: sha256, [`${name}_bytes`]: bytes };
  const text = content(sha256);
  return Option.match(text === undefined ? Option.none() : decodeJson(text), {
    onNone: () => members,
    onSome: (value) => ({ ...members, [name]: value }),
  });
}

type FactData<Type extends 'run_started' | 'run_succeeded' | 'request_answered'> = Pick<RecordedRunFact<Type>, 'data'>;

export function inputShownOf(started: FactData<'run_started'>, content: KeptContent): PayloadShown {
  return payloadShownOf('input', inputPayloadOf(started), content);
}

export function outputShownOf(succeeded: FactData<'run_succeeded'>, content: KeptContent): PayloadShown {
  return payloadShownOf('output', outputPayloadOf(succeeded), content);
}

export function answerShownOf(answered: FactData<'request_answered'>, content: KeptContent): PayloadShown {
  return payloadShownOf('answer', answerPayloadOf(answered), content);
}
