import { Result, Schema, SchemaIssue, type SchemaAST } from 'effect';
import { describe, expect, it } from 'vitest';

import { CloudEventSchema, EventToPublishSchema } from './cloud-event.ts';

const strictly: SchemaAST.ParseOptions = { onExcessProperty: 'error', errors: 'all' };

const decodeToPublish = Schema.decodeUnknownResult(Schema.toCodecJson(EventToPublishSchema), strictly);

const decodeStored = Schema.decodeUnknownResult(Schema.toCodecJson(CloudEventSchema), strictly);

const monthClosed = { source: '/ledger/eu', type: 'com.acme.ledger.month-closed' };

function nested(levels: number): Schema.Json {
  return levels === 0 ? 'eu' : [nested(levels - 1)];
}

function refusals(input: unknown): readonly string[] {
  const decoded = decodeToPublish(input);
  return Result.isSuccess(decoded)
    ? []
    : SchemaIssue.makeFormatterStandardSchemaV1()(decoded.failure.issue).issues.map(
        ({ path = [] }) => `/${path.map(String).join('/')}`,
      );
}

describe('an event to publish', () => {
  it('needs a source and a type, and takes the other attributes of CloudEvents 1.0 and extensions as given', () => {
    const event = {
      specversion: '1.0',
      id: 'm-2026-09',
      ...monthClosed,
      subject: 'september',
      time: '2026-10-01T08:59:00.123+02:00',
      datacontenttype: 'application/json',
      dataschema: 'https://acme.example/schemas/month-closed',
      data: { region: 'eu', totals: [120, 80] },
      tenant: 'acme',
      attempt: 2,
      replayed: false,
    };

    expect(decodeToPublish(event)).toEqual(Result.succeed(event));
    expect(decodeToPublish(monthClosed)).toEqual(Result.succeed(monthClosed));
  });

  it('takes a source that is any URI reference, and a time in RFC 3339 on a day that exists', () => {
    expect(refusals({ ...monthClosed, source: 'https://acme.example/ledger?region=eu#close' })).toEqual([]);
    expect(refusals({ ...monthClosed, source: 'urn:acme:ledger:eu' })).toEqual([]);
    expect(refusals({ ...monthClosed, source: 'ledger%20eu' })).toEqual([]);
    expect(refusals({ ...monthClosed, time: '2028-02-29t23:59:60z' })).toEqual([]);
    expect(refusals({ ...monthClosed, time: '0000-02-29T00:00:00Z' })).toEqual([]);
  });
});

describe('an event the playbook does not take', () => {
  it('is refused for a missing or empty source and type, and a source that is no URI reference', () => {
    expect(refusals({})).toEqual(['/source', '/type']);
    expect(refusals({ source: '', type: '' })).toEqual(['/source', '/type']);
    expect(refusals({ ...monthClosed, source: 'the ledger' })).toEqual(['/source']);
    expect(refusals({ ...monthClosed, source: 'ledger%2' })).toEqual(['/source']);
  });

  it('is refused for another version of CloudEvents, an empty id or subject, and a time that is not RFC 3339', () => {
    expect(refusals({ ...monthClosed, specversion: '0.3' })).toEqual(['/specversion']);
    expect(refusals({ ...monthClosed, id: '', subject: '' })).toEqual(['/id', '/subject']);
    expect(refusals({ ...monthClosed, time: '2026-10-01' })).toEqual(['/time']);
    expect(refusals({ ...monthClosed, time: '2026-10-01T09:00Z' })).toEqual(['/time']);
    expect(refusals({ ...monthClosed, time: '2026-02-29T09:00:00Z' })).toEqual(['/time']);
    expect(refusals({ ...monthClosed, time: '2026-10-01T09:00:00.1234567890Z' })).toEqual(['/time']);
  });

  it('is refused for a data schema that is not an absolute URI, and for attributes past their lengths', () => {
    expect(refusals({ ...monthClosed, dataschema: '/schemas/month-closed' })).toEqual(['/dataschema']);
    expect(refusals({ ...monthClosed, id: 'i'.repeat(257), type: 't'.repeat(257) })).toEqual(['/id', '/type']);
    expect(refusals({ ...monthClosed, subject: 's'.repeat(1025) })).toEqual(['/subject']);
  });

  it('takes data that nests 510 levels deep, so that a run can hold the event in a list, and refuses data deeper', () => {
    expect(refusals({ ...monthClosed, data: nested(510) })).toEqual([]);
    expect(refusals({ ...monthClosed, data: nested(511) })).toEqual(['/data']);
    expect(refusals({ ...monthClosed, data: nested(3000) })).toEqual(['/data']);
  });

  it('is refused for an extension that is not named in lowercase letters and digits, or whose value is no text, boolean or integer', () => {
    expect(
      refusals({
        ...monthClosed,
        Tenant: 'acme',
        data_base64: 'AAEC',
        regions: ['eu'],
        weight: 1.5,
        big: 2_147_483_648,
        small: -2_147_483_649,
        nothing: null,
        least: -2_147_483_648,
        most: 2_147_483_647,
      }),
    ).toEqual(['/Tenant', '/data_base64', '/regions', '/weight', '/big', '/small', '/nothing']);
  });
});

const lowercase = 'abcdefghijklmnopqrstuvwxyz';

function extensions(count: number) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [`x${index}`, index]));
}

describe('the text of an event', () => {
  it('holds no control character, unpaired surrogate or noncharacter, in any text attribute', () => {
    const unspeakable = ['\u0000', '\u0001', '\u001F', '\u007F', '\u009F', '\uD800', '\uDC00', '\uFFFE', '\uFDD0'];

    expect(
      unspeakable.map((character) =>
        refusals({ ...monthClosed, id: `m${character}`, type: `t${character}`, subject: `s${character}` }),
      ),
    ).toEqual(unspeakable.map(() => ['/id', '/type', '/subject']));
    expect(unspeakable.map((character) => refusals({ ...monthClosed, tenant: `a${character}` }))).toEqual(
      unspeakable.map(() => ['/tenant']),
    );
    expect(refusals({ ...monthClosed, subject: 'Grüße 😀 \u{10FFFD}', tenant: '😀' })).toEqual([]);
  });

  it('names its id, type and subject with a character that is not a space', () => {
    expect(refusals({ ...monthClosed, id: ' ', type: '  ', subject: '\u00A0\u2003' })).toEqual([
      '/id',
      '/type',
      '/subject',
    ]);
    expect(refusals({ ...monthClosed, id: ' m-1 ', subject: 'the month ' })).toEqual([]);
  });
});

describe('the extensions of an event', () => {
  it('are named in at most 20 lowercase letters and digits', () => {
    expect(refusals({ ...monthClosed, [lowercase.slice(0, 20)]: 'x' })).toEqual([]);
    expect(refusals({ ...monthClosed, [lowercase.slice(0, 21)]: 'x', ['a'.repeat(300)]: 'x' })).toEqual([
      `/${lowercase.slice(0, 21)}`,
      `/${'a'.repeat(300)}`,
    ]);
  });

  it('number at most 32', () => {
    expect(refusals({ ...monthClosed, ...extensions(32) })).toEqual([]);
    expect(refusals({ ...monthClosed, ...extensions(33) })).toEqual(['/']);
    expect(refusals({ ...monthClosed, ...extensions(2000) })).toEqual(['/']);
  });
});

describe('the media type of the data of an event', () => {
  it('is a type and a subtype with parameters', () => {
    expect(
      [
        'application/json',
        'text/plain; charset=utf-8',
        'multipart/form-data;boundary="a \\"b\\""',
        'application/vnd.acme+json',
      ].map((type) => refusals({ ...monthClosed, datacontenttype: type })),
    ).toEqual([[], [], [], []]);
    expect(
      ['json', 'application/', 'text/plain;', 'text/plain; charset', 'text/plain; charset="utf-8'].map((type) =>
        refusals({ ...monthClosed, datacontenttype: type }),
      ),
    ).toEqual([
      ['/datacontenttype'],
      ['/datacontenttype'],
      ['/datacontenttype'],
      ['/datacontenttype'],
      ['/datacontenttype'],
    ]);
  });
});

describe('a leap second', () => {
  it('ends a day in UTC, whatever the offset of the time', () => {
    expect(
      ['2016-12-31T23:59:60Z', '2016-12-31T15:59:60.5-08:00', '2017-01-01T01:59:60+02:00'].map((time) =>
        refusals({ ...monthClosed, time }),
      ),
    ).toEqual([[], [], []]);
    expect(
      ['2016-12-31T12:00:60Z', '2016-12-31T23:58:60Z', '2016-12-31T23:59:60+01:00'].map((time) =>
        refusals({ ...monthClosed, time }),
      ),
    ).toEqual([['/time'], ['/time'], ['/time']]);
  });
});

describe('a stored event', () => {
  it('has the version of CloudEvents, its id and its time filled in', () => {
    const stored = { specversion: '1.0', id: 'm-1', ...monthClosed, time: '2026-10-01T09:00:00.000Z' };

    expect(decodeStored(stored)).toEqual(Result.succeed(stored));
    expect(Result.isFailure(decodeStored(monthClosed))).toBe(true);
  });
});
