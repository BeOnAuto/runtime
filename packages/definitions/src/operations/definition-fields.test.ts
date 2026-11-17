import { Result, Schema, SchemaIssue } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostResultBytes } from '../runs/recorded-size.ts';
import { InputField, SampleOutputField } from './definition-fields.ts';

const takes = { input: Schema.is(InputField), sampleOutput: Schema.is(SampleOutputField) };

const decoded = {
  input: Schema.decodeUnknownResult(InputField),
  sampleOutput: Schema.decodeUnknownResult(SampleOutputField),
};

const failureOf = SchemaIssue.makeFormatterStandardSchemaV1();

function textOf(bytes: number): string {
  return 'x'.repeat(bytes - JSON.stringify('').length);
}

function refusalOf(field: keyof typeof decoded, text: string): readonly string[] {
  const answer = decoded[field](text);
  return Result.isFailure(answer) ? failureOf(answer.failure.issue).issues.map(({ message }) => message) : [];
}

describe('what a step takes and what a page renders over', () => {
  it('take as much as a run may answer, 1 MiB as JSON, and one byte more is refused', () => {
    expect([
      takes.input(textOf(mostResultBytes)),
      takes.input(textOf(mostResultBytes + 1)),
      takes.sampleOutput(textOf(mostResultBytes)),
      takes.sampleOutput(textOf(mostResultBytes + 1)),
    ]).toEqual([true, false, true, false]);
  });

  it('are refused in words that give the size, the bound and what to do instead', () => {
    expect([
      refusalOf('input', textOf(mostResultBytes + 1)),
      refusalOf('sampleOutput', textOf(mostResultBytes + 1)),
    ]).toEqual([[expect.any(String)], [expect.any(String)]]);
  });
});
