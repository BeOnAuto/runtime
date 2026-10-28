import type { Outcome, Succeeded } from '@on.auto/operations';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { reconnected, reconnecting, type Added } from '../testing/additions.ts';
import { brokenCrm, connectedCrm, giving } from '../testing/crm-connections.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

const fiveMinutesLater = '2026-10-15T14:05:00.000Z';

const aDayAndAMinuteLater = '2026-10-16T14:01:00.000Z';

const aDayAndTenMinutesLater = '2026-10-16T14:10:00.000Z';

function outputOf(outcome: Outcome<Succeeded>): unknown {
  return 'output' in outcome ? outcome.output : undefined;
}

function linkingOf(h: Harness) {
  const { registration } = operationNamed(h.operations, 'reconnect_connection');
  return Option.getOrThrow(Option.fromNullishOr('link' in registration ? registration.link : undefined));
}

function answeredAfter(h: Harness, link: Added, at: string): Promise<Outcome<Succeeded>> {
  return h.call({ registration: linkingOf(h).answerAfter(link) }, ada, { id: link.id }, at);
}

function wordsOf(h: Harness, output: unknown, id: string): string {
  const { registration } = operationNamed(h.operations, 'reconnect_connection');
  const words = Option.getOrThrow(
    Option.fromNullishOr('plainLanguage' in registration ? registration.plainLanguage : undefined),
  );
  return words.outcome(output, { id });
}

describe('the answer after the link of a reconnection', () => {
  it('asks an agent to have the person open the link, and answers the connection as it stands once they did', async () => {
    const h = harness();
    const id = await brokenCrm(h);
    const outcome = await reconnecting(h, id);
    const link = await reconnected(h, id, aDayAndAMinuteLater);
    await giving(h, link, 'Bearer crm-key-7d2e4b19', aDayAndAMinuteLater);

    const after = await answeredAfter(h, link, aDayAndAMinuteLater);
    const output = outputOf(outcome);

    expect(linkingOf(h).idOf(output)).toBe(id);
    expect(linkingOf(h).toOpen(output)?.message).toBe(
      'Open this page to approve the connection “crm”, and give its credential where it takes one, within 24 hours.',
    );
    expect(after).toMatchObject({ output: { id, status: 'connected' } });
    expect(after).not.toHaveProperty('output.connect');
    expect(wordsOf(h, outputOf(after), id)).toBe('Connected the connection “crm”; nothing is left to open.');
  });

  it('says of a connection that stayed connected that the link ran out and it stands as it was', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    const link = await reconnected(h, id);

    const after = await answeredAfter(h, link, aDayAndAMinuteLater);

    expect(after).toMatchObject({ output: { id, status: 'connected', link_ran_out: true } });
    expect(wordsOf(h, outputOf(after), id)).toBe(
      'The link of the connection “crm” ran out unused, so the connection stands as it was, connected.',
    );
  });
});

describe('the answer after a link a later reconnection replaced', () => {
  it('says a newer link replaced it while the newer one is open, and to reconnect once that one ran out too', async () => {
    const h = harness();
    const id = await brokenCrm(h);
    const first = await reconnected(h, id);
    await reconnected(h, id, fiveMinutesLater);

    const whileOpen = await answeredAfter(h, first, fiveMinutesLater);
    const ranOut = await answeredAfter(h, first, aDayAndTenMinutesLater);

    expect(whileOpen).toMatchObject({ output: { id, status: 'broken', link_replaced: true } });
    expect(whileOpen).not.toHaveProperty('output.connect');
    expect(wordsOf(h, outputOf(whileOpen), id)).toBe(
      'The connection “crm” is broken, and a newer link, still open, replaced the one offered: the person who added it opens the newest, and reconnecting it would replace that one too.',
    );
    expect(ranOut).toMatchObject({ output: { id, status: 'broken' } });
    expect(ranOut).not.toHaveProperty('output.link_replaced');
    expect(ranOut).not.toHaveProperty('output.link_ran_out');
    expect(wordsOf(h, outputOf(ranOut), id)).toBe(
      'The connection “crm” is broken, and its link is used up or expired, so nothing is left to open: reconnect it for a new link.',
    );
  });

  it('answers no link where the link it offered was used up before a later reconnection gave another', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    const used = await reconnected(h, id);
    await giving(h, used, 'Bearer crm-key-7d2e4b19');
    await reconnected(h, id, fiveMinutesLater);

    const after = await answeredAfter(h, used, fiveMinutesLater);

    expect(after).toMatchObject({ output: { id, status: 'connected' } });
    expect(after).not.toHaveProperty('output.connect');
    expect(after).not.toHaveProperty('output.link_replaced');
  });
});
