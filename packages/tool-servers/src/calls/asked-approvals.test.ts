import { Option } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ToolResult } from '../bounds/tool-results.ts';
import { askedDigest, askingForApproval, farExpiry } from '../mcp-testing/fake-approvals.ts';
import { openFakeToolRun, type FakeToolRun } from '../testing/fake-tool-run.ts';
import { toolRunId } from '../testing/tool-runs.ts';
import { askedApprovalOf, confirmationNeededKey } from './asked-approvals.ts';
import { approvalKey, runIdKey } from './call-meta.ts';
import type { OfferedTool } from './offered-tools.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const asking = {
  request: 'approval-1',
  tool: 'browser_click',
  digest: 'sha256-of-the-arguments',
  kind: 'pay',
  action: 'Click "Pay now"',
  site: 'shop.example',
  person: 'person:user_7kLm2',
  expires_at: '2026-11-05T10:10:00Z',
};

function resultOf(fields: unknown, isError = true): ToolResult {
  return { isError, content: [{ type: 'text', text: 'Needs approval' }], _meta: { [confirmationNeededKey]: fields } };
}

const kept = (text: string) => text;

const scrubbingTheSite = (text: string) => text.replaceAll('shop.example', '[redacted]');

describe('the answer of a tool that asks for a person’s approval', () => {
  it('names the approval, the tool, the digest, the action and its expiry, and the kind, the site and the person where given', () => {
    expect(askedApprovalOf(resultOf(asking), kept)).toEqual({ ...asking, expires_at: '2026-11-05T10:10:00.000Z' });
    const { kind: _kind, site: _site, person: _person, ...required } = asking;
    expect(askedApprovalOf(resultOf(required), kept)).toEqual({ ...required, expires_at: '2026-11-05T10:10:00.000Z' });
  });

  it('is scrubbed of the secrets of the run’s servers, as every answer is', () => {
    expect(askedApprovalOf(resultOf(asking), scrubbingTheSite)?.site).toBe('[redacted]');
  });

  it('may say that nobody can approve the call', () => {
    expect(askedApprovalOf(resultOf({ ...asking, request: null }), kept)?.request).toBeNull();
  });

  it('is an ordinary answer when it is no error, names no approval, or names one a field of which it cannot hold', () => {
    const malformed: readonly Readonly<Record<string, unknown>>[] = [
      { ...asking, tool: '' },
      { ...asking, digest: 'line\nbreak' },
      { ...asking, action: 'a'.repeat(1025) },
      { ...asking, expires_at: 'tomorrow' },
      { ...asking, request: 7 },
    ];
    expect([
      askedApprovalOf(resultOf(asking, false), kept),
      askedApprovalOf({ isError: true, content: [] }, kept),
      ...malformed.map((fields) => askedApprovalOf(resultOf(fields), kept)),
    ]).toEqual(Array.from({ length: 7 }));
  });
});

async function payingRun(): Promise<FakeToolRun> {
  const run = await openFakeToolRun(['pay', 'search'], undefined, { tools: [askingForApproval()] });
  closing.push(run.close);
  return run;
}

function offeredIn({ tools }: FakeToolRun, tool: string): OfferedTool {
  return Option.getOrThrow(Option.fromNullishOr(tools.offered.find(({ name }) => name === `graph__${tool}`)));
}

const unstopped = new AbortController().signal;

describe('a call a run sends itself, when its tool asks for an approval', () => {
  it('answers what the tool asked beside how the call ended, and nothing for a tool that asks for none', async () => {
    const run = await payingRun();
    const paying = await offeredIn(run, 'pay').send({ callId: 'toolu_1', input: { order: 'A-17' } }, unstopped);
    const found = await offeredIn(run, 'search').send({ callId: 'toolu_2', input: { query: 'acme' } }, unstopped);

    expect(paying.reply.isError).toBe(true);
    expect(paying.asked).toEqual({
      request: 'approval-1',
      tool: 'pay',
      digest: askedDigest,
      kind: 'pay',
      action: 'Pay for order A-17',
      site: 'shop.example',
      person: 'person:user_7kLm2',
      expires_at: farExpiry,
    });
    expect(found).not.toHaveProperty('asked');
  });

  it('carries the approval it is sent with in its metadata, beside the run’s id', async () => {
    const run = await payingRun();
    const paid = await offeredIn(run, 'pay').send(
      { callId: 'toolu_1', input: { order: 'A-17' }, approval: 'signed-approval-of-priya' },
      unstopped,
    );

    expect(paid.reply).toEqual({
      text: 'Paid for order A-17 with the approval signed-approval-of-priya.',
      isError: false,
    });
    expect(paid).not.toHaveProperty('asked');
    expect(run.fake.received().at(-1)?.meta).toMatchObject({
      [approvalKey]: 'signed-approval-of-priya',
      [runIdKey]: toolRunId,
    });
  });
});
