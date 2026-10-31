import { issueText } from '@on.auto/definitions/document';
import { standingRenderClock } from '@on.auto/definitions/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { parseInteractionDocument } from '../document/document-parsing.ts';
import { notificationDocument, threadDocument } from '../testing/index.ts';

function problemsOf(source: string): readonly string[] {
  const parsed = parseInteractionDocument(source, standingRenderClock);
  return Result.isFailure(parsed) ? parsed.failure.map((issue) => issueText(issue)) : [];
}

function ruleOf(source: string) {
  const parsed = parseInteractionDocument(source, standingRenderClock);
  return Result.isSuccess(parsed) && parsed.success.shape === 'request' ? parsed.success.reply : 'refused';
}

function withAnswer(schema: readonly string[], rule: readonly string[] = []): string {
  return [
    '---',
    "to: '#approvals-sales'",
    'expires: P2D',
    'output:',
    '  schema:',
    ...schema.map((line) => `    ${line}`),
    ...rule,
    '---',
    'Approve?',
  ].join('\n');
}

describe('the reply rule of an interaction function', () => {
  it('maps the first word to a value of the enum, with the words listed for each, and the rest to the note', () => {
    expect(ruleOf(threadDocument())).toEqual({
      choice: { from: 'word', words: { approve: ['approved', 'yes', 'ok'], reject: ['rejected', 'no'] } },
      note: { from: 'rest' },
    });
  });

  it('is derived for one required string with an enum, or without one, and for no other answer schema', () => {
    expect([
      ruleOf(
        withAnswer([
          'type: object',
          'required: [choice]',
          'properties:',
          '  choice: { type: string, enum: [yes, no] }',
        ]),
      ),
      ruleOf(withAnswer(['type: object', 'required: [reason]', 'properties:', '  reason: { type: string }'])),
      ruleOf(withAnswer(['type: object', 'required: [count]', 'properties:', '  count: { type: integer }'])),
      ruleOf(
        withAnswer([
          'type: object',
          'required: [a, b]',
          'properties:',
          '  a: { type: string }',
          '  b: { type: string }',
        ]),
      ),
      ruleOf(withAnswer(['type: object', 'required: [reason]'])),
      ruleOf(withAnswer(['type: string'])),
      ruleOf(notificationDocument()),
      ruleOf(threadDocument({ rule: ['reply:', '  choice: word'] })),
    ]).toEqual([
      { choice: { from: 'word', words: { yes: [], no: [] } } },
      { reason: { from: 'text' } },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { choice: { from: 'word', words: { approve: [], reject: [] } } },
    ]);
  });
});

describe('a reply rule refused when the definition is saved', () => {
  it('names a property the answer schema lacks, one that is not text, and a word read from one without an enum', () => {
    expect(
      problemsOf(threadDocument({ rule: ['reply:', '  verdict: word', '  choice: text', '  count: rest'] })),
    ).toEqual([
      'Line 49, /reply/verdict: verdict is not a string property of output.schema; a reply rule names its top-level string properties',
      'Line 51, /reply/count: count is not a string property of output.schema; a reply rule names its top-level string properties',
    ]);
    expect(problemsOf(threadDocument({ rule: ['reply:', '  note: word'] }))).toEqual([
      'Line 49, /reply/note: note has no enum, so the first word of a reply cannot be read as one of its values',
    ]);
  });

  it('names a value the enum lacks, a word meant for two values, and words given where no first word is read', () => {
    expect(
      problemsOf(
        threadDocument({
          rule: [
            'reply:',
            '  choice:',
            '    from: word',
            '    words:',
            '      approve: [ok]',
            '      reject: [OK!]',
            '      maybe: [perhaps]',
            '  note: { from: rest, words: { a: [b] } }',
          ],
        }),
      ),
    ).toEqual([
      'Line 53, /reply/choice/words/reject: OK! means approve already; a word means one value only',
      'Line 54, /reply/choice/words/maybe: maybe is not a value of the enum of choice',
      'Line 55, /reply/note/words: Only a part read from the first word takes words',
    ]);
  });
});

describe('the bounds of a reply rule, held when the definition is saved', () => {
  it('holds the words to their bounds, sixteen values, sixteen words a value and 64 bytes a word', () => {
    const many = Array.from({ length: 17 }, (_, index) => `w${index}`).join(', ');

    expect(
      problemsOf(
        threadDocument({
          rule: [
            'reply:',
            '  choice:',
            '    from: word',
            '    words:',
            `      approve: [${many}]`,
            `      reject: [${'x'.repeat(65)}]`,
          ],
        }),
      ),
    ).toEqual([
      'Line 52, /reply/choice/words/approve: A value takes at most 16 words',
      'Line 53, /reply/choice/words/reject: A word takes at most 64 bytes',
    ]);
  });

  it('lists words for sixteen values at most', () => {
    const values = Array.from({ length: 17 }, (_, index) => `v${index}`);

    expect(
      problemsOf(
        withAnswer(
          [
            'type: object',
            'required: [choice]',
            'properties:',
            `  choice: { type: string, enum: [${values.join(', ')}] }`,
          ],
          [
            'reply:',
            '  choice:',
            '    from: word',
            '    words:',
            ...values.map((value) => `      ${value}: [${value}x]`),
          ],
        ),
      ),
    ).toEqual(['Line 14, /reply/choice/words: A reply rule lists words for at most 16 values']);
  });
});

describe('a function that reads replies without a reply rule', () => {
  it('is refused when saved, for an answer schema no rule is derived from and no reply block', () => {
    const unruled = threadDocument({ rule: [] }).replace('required: [choice]', 'required: [choice, note]');

    expect(problemsOf(unruled)).toEqual([
      expect.stringMatching(
        /^Line \d+, \/replies: A function that reads replies needs a reply rule: an answer schema with one required string and its enum, or a reply block that maps the words$/u,
      ),
    ]);
  });
});

describe('a reply rule on a definition that takes no answer', () => {
  it('refuses a rule on a notification, which takes no answer', () => {
    expect(
      problemsOf(notificationDocument().replace('---\nThe brief', 'reply: { note: text }\n---\nThe brief')),
    ).toEqual(['Line 20, /reply: A notification takes no answer, so it takes no reply rule']);
  });
});
