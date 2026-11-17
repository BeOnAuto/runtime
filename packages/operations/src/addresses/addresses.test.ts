import { mostNoticeCharacters } from '@on.auto/phrasing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { beforeGoingOnOf, type Notice, noticesFields, noticesIn, withNotices } from './answer-notices.ts';
import { studioLinkField, StudioLinks, studioLinkTo, type StudioPage, withStudioLink } from './studio-links.ts';

const pageNamed = (page?: StudioPage) => `https://studio.example/${page === undefined ? 'home' : page.kind}`;

const aRun: StudioPage = { kind: 'run', playbook: 'alpha', run: 'r-1' };

const linked = <A>(effect: Effect.Effect<A>) =>
  Effect.runSync(effect.pipe(Effect.provideService(StudioLinks, pageNamed)));

describe('the link to a page in Studio', () => {
  it('is none unless the server serving the call knows the address of Studio', () => {
    expect([Effect.runSync(studioLinkTo()), Effect.runSync(studioLinkTo(aRun))]).toEqual([undefined, undefined]);
  });

  it("is the page the server's links give, Studio's home where no page is named", () => {
    expect([linked(studioLinkTo()), linked(studioLinkTo(aRun))]).toEqual([
      'https://studio.example/home',
      'https://studio.example/run',
    ]);
  });
});

describe('an output with its link in Studio', () => {
  it('carries the link as studio where the server knows the address of Studio, and is left as it is where not', () => {
    const output = { run_id: 'r-1' };

    expect([Effect.runSync(withStudioLink(output, aRun)), linked(withStudioLink(output, aRun))]).toEqual([
      { run_id: 'r-1' },
      { run_id: 'r-1', studio: 'https://studio.example/run' },
    ]);
  });

  it('declares studio as an optional field, the page in Studio of what was made, saved or run', () => {
    const schema = Schema.Struct({
      made: studioLinkField('made'),
      saved: studioLinkField('saved'),
      studio: studioLinkField('run'),
    });

    expect([Schema.decodeUnknownSync(schema)({}), Schema.decodeUnknownSync(schema)({ studio: 'https://s' })]).toEqual([
      {},
      { studio: 'https://s' },
    ]);
    expect(Schema.toJsonSchemaDocument(schema).schema).toMatchObject({
      properties: {
        made: { type: 'string', description: 'The page in Studio of what was made' },
        saved: { type: 'string', description: 'The page in Studio of what was saved' },
        studio: { type: 'string', description: 'The page in Studio of what was run' },
      },
    });
  });
});

const aNotice = (kind: string, detail = `Check ${kind}.`): Notice => ({ kind, detail, certainty: 'likely' });

describe('an output with its notices', () => {
  it('is left as it is when there is nothing to double-check', () => {
    expect(withNotices({ run_id: 'r-1' }, [])).toEqual({ run_id: 'r-1' });
  });

  it('carries at most three notices, the first three it was given', () => {
    const notices = [{ ...aNotice('one'), at: '/tools' }, ...['two', 'three', 'four'].map((kind) => aNotice(kind))];

    expect(withNotices({ name: 'triage' }, notices)).toEqual({
      name: 'triage',
      notices: notices.slice(0, 3),
      before_going_on: beforeGoingOnOf(3),
    });
  });

  it('puts the notices first and the sentence that says what to do with them next', () => {
    expect(Object.keys(withNotices({ name: 'triage', version: 2 }, [aNotice('one')]))).toEqual([
      'notices',
      'before_going_on',
      'name',
      'version',
    ]);
  });

  it('carries each detail whole at 400 characters, and cut at a word with an ellipsis at 401', () => {
    const whole = 'word '.repeat(80).trimEnd().padEnd(mostNoticeCharacters, 's');
    const longer = `${whole}s`;
    const cut = `${'word '.repeat(79).trimEnd()}…`;

    expect(withNotices({}, [aNotice('whole', whole), aNotice('longer', longer)])).toEqual({
      notices: [aNotice('whole', whole), aNotice('longer', cut)],
      before_going_on: beforeGoingOnOf(2),
    });
    expect(cut.length).toBeLessThanOrEqual(mostNoticeCharacters);
  });

  it('cuts a detail with no space where it reaches its bound', () => {
    expect(withNotices({}, [aNotice('unbroken', 'x'.repeat(mostNoticeCharacters + 1))])).toEqual({
      notices: [aNotice('unbroken', `${'x'.repeat(mostNoticeCharacters - 1)}…`)],
      before_going_on: beforeGoingOnOf(1),
    });
  });
});

describe('the notices fields of an output schema', () => {
  const schema = Schema.Struct(noticesFields());

  it('is optional and takes a kind, a detail, where it is and how certain it is, and keeps where it is', () => {
    const notice: Notice = { kind: 'tools_only_read', detail: 'Check it.', at: '/tools', certainty: 'exact' };

    expect(Schema.decodeUnknownSync(schema)({})).toEqual({});
    expect(Schema.decodeUnknownSync(schema)({ notices: [notice] })).toEqual({ notices: [notice] });
  });

  it('takes the sentence that says what to do with the notices, which is optional', () => {
    const notice: Notice = { kind: 'tools_only_read', detail: 'Check it.', certainty: 'likely' };
    const answered = { notices: [notice], before_going_on: beforeGoingOnOf(1) };

    expect(Schema.decodeUnknownSync(schema)(answered)).toEqual(answered);
  });

  it('refuses a fourth notice and a detail over 400 characters', () => {
    const four = ['a', 'b', 'c', 'd'].map((kind) => aNotice(kind));
    const long = aNotice('long', 'x'.repeat(mostNoticeCharacters + 1));

    expect([Schema.is(schema)({ notices: four }), Schema.is(schema)({ notices: [long] })]).toEqual([false, false]);
  });
});

describe('the notices an output carries', () => {
  it('are read from any output, and none from one without them or not an object', () => {
    const notice = aNotice('one');

    expect([noticesIn({ notices: [notice] }), noticesIn({ name: 'x' }), noticesIn('words')]).toEqual([
      [notice],
      [],
      [],
    ]);
  });
});

describe('the sentence that says what to do with the notices', () => {
  it('counts one, two or three things to double-check, and lets the agent carry on when it is sure, saying why', () => {
    expect([1, 2, 3].map((count) => beforeGoingOnOf(count))).toEqual([
      'One thing to double-check is in notices: if you are sure of what you did, carry on and tell the person in one sentence why you kept it; if not, now is a good time to fix it.',
      'Two things to double-check are in notices: if you are sure of what you did, carry on and tell the person in one sentence why you kept them; if not, now is a good time to fix them.',
      'Three things to double-check are in notices: if you are sure of what you did, carry on and tell the person in one sentence why you kept them; if not, now is a good time to fix them.',
    ]);
  });
});
