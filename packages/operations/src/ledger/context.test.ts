import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ActedContextSchema,
  ActedOnRunContextSchema,
  ContextReference,
  DefinitionContextSchema,
  EmittedContextSchema,
  RecordedCallerSchema,
  RunContextSchema,
  bytesOfReference,
  checkedContext,
  contextOf,
  holdsNoForbiddenCharacter,
  leastCount,
  mostReferenceBytes,
  recordedCallerOf,
  type Context,
} from './context.ts';
import { factOf, recordingOf } from './decider.ts';

const ofACall: Context = {
  at: '2026-10-09T12:43:51.435Z',
  by: 'playbook:finance',
  runId: 'ccd1dbdd',
  definitionType: 'interaction',
  definitionName: 'approve-report',
  definitionVersion: 1,
  calledBy: { runId: 'run-0', reference: '/do/0/ask', run: 1 },
  callDepth: 1,
  depth: 2,
  trigger: { kind: 'event', reference: '/schedule/on' },
};

describe('the caller as the data of a fact names who did something', () => {
  it('is the id and the name of the caller, and nothing it may do, where the context names the id alone', () => {
    const recorded = recordedCallerOf({
      id: 'person:user_2ada',
      name: 'Ada Lovelace',
      org: 'acme',
      permissions: ['playbook:read'],
      playbooks: '*',
    });

    expect(recorded).toStrictEqual({ id: 'person:user_2ada', name: 'Ada Lovelace' });
    expect(Schema.decodeUnknownSync(RecordedCallerSchema)(recorded)).toStrictEqual(recorded);
  });
});

describe('the context of a recorded message', () => {
  it('is read from its metadata without the store’s own fields', () => {
    expect(
      contextOf({
        ...ofACall,
        messageId: '419f8fb7',
        streamName: 'playbook/acme/finance/runs/ccd1dbdd',
        streamPosition: '1',
        correlationId: 'run-0',
        causationId: null,
        traceId: '2e22',
      }),
    ).toEqual(ofACall);
  });

  it('refuses text with a control character, an unpaired surrogate or a noncharacter, and a long reference', () => {
    const refused = [
      { ...ofACall, by: 'playbook:\u0000finance' },
      { ...ofACall, definitionName: 'approve\uD800' },
      { ...ofACall, runId: 'run￾' },
      { ...ofACall, calledBy: { runId: 'run-0', reference: `/${'a'.repeat(256)}`, run: 1 } },
      { ...ofACall, trigger: { kind: 'event', reference: `/${'é'.repeat(128)}` } },
      { at: ofACall.at },
    ];

    expect(refused.map((context: unknown) => Result.isFailure(Result.try(() => contextOf(context))))).toEqual(
      refused.map(() => true),
    );
    expect(() => checkedContext({ ...ofACall, depth: 0 })).toThrow('Expected a value greater than or equal to 1');
    expect(checkedContext(ofACall)).toEqual(ofACall);
    expect([holdsNoForbiddenCharacter('café ✓'), holdsNoForbiddenCharacter('\u007F')]).toEqual([true, false]);
  });
});

describe('a reference a context carries', () => {
  it('takes at most 256 bytes in UTF-8, and no forbidden character', () => {
    const decodeReference = Schema.decodeUnknownSync(ContextReference);
    const longest = `/${'é'.repeat(127)}a`;

    expect([bytesOfReference(longest), mostReferenceBytes]).toEqual([256, 256]);
    expect(decodeReference(longest)).toBe(longest);
    expect(() => decodeReference(`${longest}a`)).toThrow('a reference of at most 256 bytes in UTF-8');
    expect(() => decodeReference('/do/\u0000')).toThrow(
      'text without control characters, unpaired surrogates or noncharacters',
    );
  });
});

describe('the context a fact carries', () => {
  const ofTheDefinition = { definitionType: 'interaction', definitionName: 'approve-report', definitionVersion: 1 };
  const acted = { at: ofACall.at, by: ofACall.by };

  it('holds who acted and when, and on a run the run, its definition and its chain', () => {
    expect(Schema.decodeUnknownSync(ActedContextSchema)(ofACall)).toEqual(acted);
    expect(Schema.decodeUnknownSync(ActedOnRunContextSchema)(ofACall)).toEqual({ ...acted, runId: 'ccd1dbdd' });
    expect(Schema.decodeUnknownSync(DefinitionContextSchema)(ofACall)).toEqual({ ...acted, ...ofTheDefinition });
    expect(Schema.decodeUnknownSync(RunContextSchema)(ofACall)).toEqual(ofACall);
    expect(Schema.decodeUnknownSync(EmittedContextSchema)(ofACall)).toEqual(ofACall);
  });

  it('refuses a run context without its definition, a definition context without its version, and an emitted one without its depth', () => {
    const { depth, ...withoutDepth } = ofACall;
    const { definitionVersion, ...withoutVersion } = ofACall;

    expect([depth, definitionVersion, leastCount]).toEqual([2, 1, 1]);
    expect(() => Schema.decodeUnknownSync(RunContextSchema)({ ...acted, runId: 'ccd1dbdd' })).toThrow('Missing key');
    expect(() => Schema.decodeUnknownSync(DefinitionContextSchema)(withoutVersion)).toThrow('Missing key');
    expect(() => Schema.decodeUnknownSync(EmittedContextSchema)(withoutDepth)).toThrow('Missing key');
    expect(() => Schema.decodeUnknownSync(ActedOnRunContextSchema)(acted)).toThrow('Missing key');
  });
});

describe('a fact as a decider records it', () => {
  const NotedSchema = factOf('noted', Schema.Struct({ note: Schema.String }), ActedOnRunContextSchema);
  const recorded = recordingOf(NotedSchema);

  it('names its type once beside its data and the schema of its context, and is recorded with the context it carries', () => {
    expect(recorded({ type: 'noted', data: { note: 'kept' } }, ofACall)).toEqual({
      type: 'noted',
      data: { note: 'kept' },
      context: { at: ofACall.at, by: ofACall.by, runId: 'ccd1dbdd' },
    });
    expect(() => Schema.decodeUnknownSync(NotedSchema)({ type: 'noted', data: { note: 'kept' } })).toThrow(
      'Missing key',
    );
  });

  it('is refused when the context the decider gave is not the one its fact carries', () => {
    expect(() => recorded({ type: 'noted', data: { note: 'kept' } }, { at: ofACall.at, by: ofACall.by })).toThrow(
      'Missing key',
    );
  });
});
