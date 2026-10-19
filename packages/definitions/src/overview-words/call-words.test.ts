import { describe, expect, it } from 'vitest';

import { markdownOf, type OverviewBlock, type OverviewSection } from '../index.ts';
import { callSection, callSentence } from './call-words.ts';

function writtenOf(body: readonly OverviewBlock[], appendix: readonly OverviewSection[] = []): string {
  return markdownOf({ title: 'read-costs', opening: ['Reads costs'], body, sections: [], appendix })
    .split('\n\n')
    .slice(2)
    .join('\n\n');
}

const month = { type: 'object', required: ['month'], properties: { month: { type: 'string' } } };

const rows = { type: 'array', items: { type: 'object', properties: { campaign: { type: 'string' } } } };

describe('the sentence of an interaction function that asks a system', () => {
  it('says what it is given, the server and the tool it asks once per run, and where in the answer it reads', () => {
    expect([
      writtenOf([callSentence({ input: month, server: 'ads', tool: 'campaign-costs', read: '/rows', output: rows })]),
      writtenOf([callSentence({ server: 'chat', tool: 'thread', read: '/data/items~1all~0x', output: rows })]),
      writtenOf([
        callSentence({
          input: month,
          server: 'ads',
          tool: 'campaign-costs',
          output: {
            type: 'object',
            required: ['rows'],
            properties: { rows: { type: 'array' }, next: { type: 'string' } },
          },
        }),
      ]),
    ]).toEqual([
      'It is given the month and asks **ads** with its tool `campaign-costs`, once per run. It answers with what it answered under `rows`: a list of records.\n',
      'It is given any input and asks **chat** with its tool `thread`, once per run. It answers with what it answered under `data`, then `items/all~x`: a list of records.\n',
      'It is given the month and asks **ads** with its tool `campaign-costs`, once per run. It answers with the whole of what the tool answered: the rows, and the next, when there is one.\n',
    ]);
  });
});

describe('the names of the call of an interaction function, in the body', () => {
  it('are code, so a tool or a segment of the read path that holds Markdown is written as it is, on one line', () => {
    const written = writtenOf([
      callSentence({ server: 'chat', tool: 'read_*all*', read: '/a*b*/x\n## Details', output: rows }),
    ]);

    expect(written).toBe(
      'It is given any input and asks **chat** with its tool `read_*all*`, once per run. It answers with what it answered under `a*b*`, then `x ## Details`: a list of records.\n',
    );
    expect(written.split('\n')).not.toContain('## Details');
  });
});

describe('the call of an interaction function, under Details', () => {
  it('names the tool and its server, where it reads in the answer and each argument as written', () => {
    expect([
      writtenOf(
        [],
        [
          callSection({
            server: 'ads',
            tool: 'campaign-costs',
            read: '/rows',
            arguments: { month: '{{ input.month }}', limit: 100, flags: { all: true } },
          }),
        ],
      ),
      writtenOf([], [callSection({ server: 'chat', tool: 'channels' })]),
    ]).toEqual([
      '## Details\n\n### Call\n\nIt calls the tool `campaign-costs` of the server **ads**, its answer read at `/rows`, with these arguments, as written:\n\n- `month`: `{{ input.month }}`\n- `limit`: `100`\n- `flags`: `{"all":true}`\n',
      '## Details\n\n### Call\n\nIt calls the tool `channels` of the server **chat**, its whole answer read, with no arguments.\n',
    ]);
  });
});
