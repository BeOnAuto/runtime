import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { sessionRowsInMemory } from '../testing/session-rows-in-memory.ts';
import type { SessionRow, SessionRows, SessionUse } from './session-rows.ts';
import { mostLifetimeMs, mostUnusedMs, sessionsOf, type Sessions } from './sessions.ts';

const person = { issuer: 'https://login.example.com/tenant/v2.0', subject: 'AItOawmwtWwcT0k51BayewNvutrJUqsvl6qs7A4' };

const aMinute = 60_000;

const aDay = 1440 * aMinute;

const signedInAt = Date.parse('2026-11-18T09:00:00Z');

interface Clocked {
  readonly sessions: Sessions;
  readonly kept: SessionRow[];
  readonly used: SessionUse[];
  readonly pass: (ms: number) => void;
}

function clocked(): Clocked {
  const clock = { now: signedInAt };
  const rows = sessionRowsInMemory();
  const kept: SessionRow[] = [];
  const used: SessionUse[] = [];
  const watched: SessionRows = {
    ...rows,
    kept: (row) => {
      kept.push(row);
      return rows.kept(row);
    },
    used: (use) => {
      used.push(use);
      return rows.used(use);
    },
  };
  return {
    sessions: sessionsOf(watched, () => clock.now),
    kept,
    used,
    pass: (ms) => {
      clock.now += ms;
    },
  };
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe("a person's session, as it begins", () => {
  it('is a random identifier the server keeps only the SHA-256 of, beside the issuer and the subject as given', async () => {
    const { sessions, kept } = clocked();

    const first = await sessions.begun(person);
    const second = await sessions.begun(person);

    expect([first, second]).toEqual([expect.stringMatching(/^[\w-]{43}$/u), expect.not.stringMatching(first)]);
    expect(kept.map(({ sha256, issuer, subject }) => ({ sha256, issuer, subject }))).toEqual([
      { sha256: sha256Hex(first), ...person },
      { sha256: sha256Hex(second), ...person },
    ]);
    expect(JSON.stringify(kept)).not.toContain(first);
    expect([await sessions.personOf(first), await sessions.personOf('an identifier never given')]).toEqual([
      person,
      undefined,
    ]);
  });
});

describe("a person's session, as time passes", () => {
  it('ends after 7 days unused', async () => {
    const { sessions, pass } = clocked();
    const identifier = await sessions.begun(person);

    pass(mostUnusedMs - 1);
    const justBefore = await sessions.personOf(identifier);
    pass(mostUnusedMs);

    expect([justBefore, await sessions.personOf(identifier)]).toEqual([person, undefined]);
    expect(mostUnusedMs).toBe(7 * aDay);
  });

  it('lasts while it is used, and ends 30 days after the sign-in however often it is used', async () => {
    const { sessions, pass } = clocked();
    const identifier = await sessions.begun(person);
    const usedAfter = (ms: number) => {
      pass(ms);
      return sessions.personOf(identifier);
    };

    const seen = [
      await usedAfter(6 * aDay),
      await usedAfter(6 * aDay),
      await usedAfter(6 * aDay),
      await usedAfter(6 * aDay),
      await usedAfter(6 * aDay - 1),
      await usedAfter(1),
    ];

    expect(seen).toEqual([person, person, person, person, person, undefined]);
    expect(mostLifetimeMs).toBe(30 * aDay);
  });

  it('ends at once when the person signs out, and only that session', async () => {
    const { sessions } = clocked();
    const identifier = await sessions.begun(person);
    const another = await sessions.begun(person);

    await sessions.ended(identifier);

    expect([await sessions.personOf(identifier), await sessions.personOf(another)]).toEqual([undefined, person]);
  });
});

describe("a person's session, as it is used", () => {
  it('records a use at most once in ten minutes, each recorded use moving its expiry', async () => {
    const { sessions, used, pass } = clocked();
    const identifier = await sessions.begun(person);
    const usedAfter = (ms: number) => {
      pass(ms);
      return sessions.personOf(identifier);
    };

    const seen = [
      await usedAfter(aMinute),
      await usedAfter(9 * aMinute - 1),
      await usedAfter(1),
      await usedAfter(5 * aMinute),
      await usedAfter(5 * aMinute),
    ];

    expect(seen).toEqual([person, person, person, person, person]);
    expect(used.map(({ lastUsedAt, expiresAt }) => [lastUsedAt - signedInAt, expiresAt - lastUsedAt])).toEqual([
      [10 * aMinute, mostUnusedMs],
      [20 * aMinute, mostUnusedMs],
    ]);
  });

  it('ends 7 days after the last use recorded, at most ten minutes before 7 days after the last use', async () => {
    const { sessions, used, pass } = clocked();
    const identifier = await sessions.begun(person);

    pass(10 * aMinute - 1);
    const unrecorded = await sessions.personOf(identifier);
    pass(mostUnusedMs - 10 * aMinute + 1);

    expect([unrecorded, await sessions.personOf(identifier), used]).toEqual([person, undefined, []]);
  });
});
