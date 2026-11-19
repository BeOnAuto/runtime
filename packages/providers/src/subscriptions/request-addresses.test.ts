import { describe, expect, it } from 'vitest';

import { isAddressedAsWritten } from './request-addresses.ts';

const ofOneValue = '{{ with.project }}';

const ofTwoValues = '{{ with.owner }}/{{ with.project }}';

const theHooks = 'https://api.tracker.example.com/projects/{{ topic }}/hooks';

const theHook = 'https://api.tracker.example.com/projects/{{ topic }}/hooks/{{ subscription.id }}';

function hooksOf(topic: string, written = ofOneValue): boolean {
  const rendered = `https://api.tracker.example.com/projects/${topic}/hooks`;
  return isAddressedAsWritten(theHooks, rendered, { written, rendered: topic });
}

function hookOf(id: string): boolean {
  const rendered = `https://api.tracker.example.com/projects/alpha/hooks/${id}`;
  return isAddressedAsWritten(theHook, rendered, { written: ofOneValue, rendered: 'alpha' });
}

const shapes: ReadonlyArray<readonly [string, string]> = [
  ['a slash', 'a/b'],
  ['a dot segment', '..'],
  ['a dot segment of one dot', '.'],
  ['a question mark', 'a?b'],
  ['a hash', 'a#b'],
  ['an encoded slash', 'a%2fb'],
  ['an encoded dot', '%2e'],
  ['a backslash', 'a\\b'],
  ['two dots split by a tab, which parsing drops', '.\t.'],
  ['a space, which parsing encodes', 'a b'],
];

describe('a value rendered into the URL of a request', () => {
  it.each(shapes)('is refused where it carries %s of its own', (_shape, value) => {
    expect([hooksOf(value), hookOf(value)]).toEqual([false, false]);
  });

  it('is sent where it sits whole in the place the entry wrote for it', () => {
    expect([hooksOf('site.v2-beta_1~x:y@z'), hookOf('f0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f')]).toEqual([true, true]);
  });

  it('is sent where the topic’s two values are joined by the entry’s own slash, and refused where a value adds one', () => {
    expect([hooksOf('acme/site', ofTwoValues), hooksOf('acme/site/x', ofTwoValues)]).toEqual([true, false]);
    expect([hooksOf('acme/..', ofTwoValues), hooksOf('../site', ofTwoValues)]).toEqual([false, false]);
  });

  it('counts no delimiter of the topic as the entry’s where the destination writes no topic it can read', () => {
    const rendered = 'https://api.tracker.example.com/projects/acme/site/hooks';

    expect(isAddressedAsWritten(theHooks, rendered, { written: undefined, rendered: 'acme/site' })).toBe(false);
    expect(isAddressedAsWritten(theHooks, rendered, { written: '{{ with.owner', rendered: 'acme/site' })).toBe(false);
  });
});

const inTheQuery = 'https://api.tracker.example.com?project={{ topic }}';

function queriedFor(topic: string): boolean {
  const rendered = `https://api.tracker.example.com?project=${topic}`;
  return isAddressedAsWritten(inTheQuery, rendered, { written: ofOneValue, rendered: topic });
}

describe('the address a request is sent to', () => {
  const alpha = { written: ofOneValue, rendered: 'alpha' };

  it('takes a topic of any shape where the URL does not place it, and one in a query the entry writes', () => {
    const anyShape = { written: ofOneValue, rendered: 'a/../b?c#d' };
    const hooks = 'https://api.tracker.example.com/hooks';

    expect(isAddressedAsWritten(hooks, hooks, anyShape)).toBe(true);
    expect([queriedFor('alpha'), queriedFor('alpha#top'), queriedFor('alpha?all=true')]).toEqual([true, false, false]);
  });

  it('is refused at an origin or a scheme the entry does not write, or where it does not parse', () => {
    expect(isAddressedAsWritten(theHooks, 'https://api.elsewhere.example.com/projects/alpha/hooks', alpha)).toBe(false);
    expect(isAddressedAsWritten(theHooks, 'http://api.tracker.example.com/projects/alpha/hooks', alpha)).toBe(false);
    expect(isAddressedAsWritten('https://{{ topic }}/hooks', 'https://alpha/hooks', alpha)).toBe(false);
    expect(isAddressedAsWritten(theHooks, 'https://not a host/projects/alpha/hooks', alpha)).toBe(false);
  });
});
