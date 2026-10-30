import { sha256Of } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { uploading } from '../testing/upload-calls.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const header = 'series,period,orders,basket';

const valid = [
  header,
  'east,2026-W40,3,12.5',
  'east,2026-W41,,',
  'north,2026-W39,1,0',
  '"north, upper",2026-W40,0,-1e3',
].join('\r\n');

async function refusedWith(body: string | Readonly<Uint8Array>): Promise<unknown> {
  const { upload, content } = uploading();
  const settled = await upload(body, sha256Of(body));
  expect(await Effect.runPromise(content.get(alpha, sha256Of(body)))).toBeUndefined();
  return settled;
}

function atLine(line: number, detail: string) {
  return {
    status: 'rejected',
    reason: 'invalid_input',
    detail: `The dataset is refused at line ${line}`,
    issues: [{ pointer: '', detail: `Line ${line}: ${detail}` }],
  };
}

const faults: readonly (readonly [string, string, number, string])[] = [
  ['an empty body', '', 1, 'The dataset holds no rows; write its header and then one row a series and period'],
  ['a header alone', header, 1, 'The dataset holds no rows; write its header and then one row a series and period'],
  [
    'a header without the series',
    'period,orders\r\n2026,1',
    1,
    'The header starts with series,period, then names the target and the features',
  ],
  [
    'a header of one column',
    'series\r\nnorth',
    1,
    'The header starts with series,period, then names the target and the features',
  ],
  [
    'a header with no target',
    'series,period\r\nnorth,2026',
    1,
    'The header names the target and at most 40 features after series,period',
  ],
  [
    'a column named twice',
    'series,period,orders,orders\r\nnorth,2026,1,1',
    1,
    'The column "orders" is not a name a dataset\'s column takes, or is named twice: 1 to 64 lowercase letters, digits and underscores, starting with a letter',
  ],
  ['a row of too few fields', `${header}\r\nnorth,2026-W40,1`, 2, 'The row has 3 fields where the header names 4'],
  [
    'a period of no form',
    `${header}\r\nnorth,week 40,1,1`,
    2,
    'The period "week 40" is not in an ISO 8601 form: YYYY-MM-DD, YYYY-Www, YYYY-MM, YYYY-Qn or YYYY',
  ],
  [
    'a period of another grain',
    `${header}\r\nnorth,2026-W40,1,1\r\nnorth,2026-11,1,1`,
    3,
    'The period "2026-11" is not a week written as the first row writes one',
  ],
  ['an empty series', `${header}\r\n,2026-W40,1,1`, 2, 'The series is text of 1 to 256 bytes'],
  [
    'a value that is not a number',
    `${header}\r\nnorth,2026-W40,one,1`,
    2,
    'The value "one" is not a JSON number or empty',
  ],
  [
    'a value past what a number holds',
    `${header}\r\nnorth,2026-W40,1e999,1`,
    2,
    'The value "1e999" is not a JSON number or empty',
  ],
  [
    'a period before the last',
    `${header}\r\nnorth,2026-W40,1,1\r\nnorth,2026-W39,1,1`,
    3,
    'The rows are sorted by series then period, one row a series and period, and this one comes out of order',
  ],
  [
    'a series before the last',
    `${header}\r\nnorth,2026-W40,1,1\r\neast,2026-W41,1,1`,
    3,
    'The rows are sorted by series then period, one row a series and period, and this one comes out of order',
  ],
  [
    'a quote inside a field',
    `${header}\r\nno"rth,2026-W40,1,1`,
    2,
    'A quote stands inside a field that does not start with one; quote the whole field and double the quote',
  ],
  [
    'a field going on after its quote',
    `${header}\r\n"north"x,2026-W40,1,1`,
    2,
    'A quoted field goes on after its closing quote; a field ends at its closing quote',
  ],
  ['a quote never closed', `${header}\r\n"north,2026-W40,1,1`, 2, 'A quoted field is never closed'],
  [
    'a carriage return alone',
    `${header}\rnorth,2026-W40,1,1`,
    1,
    'A carriage return is not followed by a line feed; end each record with CRLF or LF',
  ],
  [
    'a carriage return at the end',
    `${header}\r\nnorth,2026-W40,1,1\r`,
    2,
    'A carriage return is not followed by a line feed; end each record with CRLF or LF',
  ],
];

describe('an upload of a dataset', () => {
  it('keeps the body under its digest and answers its figures', async () => {
    const { upload, content } = uploading();
    const sha256 = sha256Of(valid);

    expect(await upload(valid, sha256)).toEqual({
      status: 'succeeded',
      output: {
        dataset: sha256,
        bytes: Buffer.byteLength(valid),
        rows: 4,
        series: 3,
        columns: ['orders', 'basket'],
        period: 'week',
        first_period: '2026-W39',
        last_period: '2026-W41',
      },
    });
    expect(await Effect.runPromise(content.get(alpha, sha256))).toMatchObject({ bytes: Buffer.byteLength(valid) });
  });

  it('takes records ended by LF, a last record without its end, and quoted fields over lines', async () => {
    const body = `${header}\neast,2026-W40,1,2\n"north\nupper",2026-W40,1,""\n`;
    const { upload } = uploading();

    expect(await upload(body, sha256Of(body))).toMatchObject({ status: 'succeeded', output: { rows: 2, series: 2 } });
    expect(await upload(`${header}\neast,2026,1,2`, sha256Of(`${header}\neast,2026,1,2`))).toMatchObject({
      output: { period: 'year' },
    });
  });
});

describe('an upload of a dataset that is refused', () => {
  it('refuses a body whose digest is not the path’s, keeping nothing', async () => {
    const { upload, content } = uploading();
    const other = 'a'.repeat(64);

    expect(await upload(valid, other)).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: `The body's digest is ${sha256Of(valid)} and the path says ${other}`,
      issues: [{ pointer: '/sha256', detail: `The body's digest is ${sha256Of(valid)} and the path says ${other}` }],
    });
    expect(await Effect.runPromise(content.get(alpha, sha256Of(valid)))).toBeUndefined();
  });
});

describe('an upload of a dataset that breaks the grammar', () => {
  it.each(faults)('refuses %s at its first faulty line, keeping nothing', async (_case, body, line, detail) => {
    expect(await refusedWith(body)).toEqual(atLine(line, detail));
  });
});

describe('an upload of a dataset past what a dataset is', () => {
  it('refuses a body that is not UTF-8, and rows past the dataset’s bounds', async () => {
    const { upload } = uploading();
    const many = [
      header,
      ...Array.from({ length: 1001 }, (_, series) => `s${String(series).padStart(4, '0')},2026-W40,1,1`),
    ].join('\n');

    const broken = new Uint8Array([...new TextEncoder().encode(`${header}\nnorth,2026-W40,`), 0xff]);
    const cut = new Uint8Array([...new TextEncoder().encode(`${header}\nnorth,2026-W40,1,`), 0xc3]);

    expect(await refusedWith(broken)).toEqual(atLine(2, 'The body is not text in UTF-8'));
    expect(await refusedWith(cut)).toEqual(atLine(2, 'The body is not text in UTF-8'));
    expect(await upload(many, sha256Of(many))).toEqual(
      atLine(1002, 'A dataset holds at most 200,000 rows over at most 1,000 series'),
    );
  });
});
