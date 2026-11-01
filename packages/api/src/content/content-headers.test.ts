import { textToKeep } from '@on.auto/content';
import { memoryRecordedContent } from '@on.auto/content/testing';
import { contentAddressesUnder } from '@on.auto/identity';
import { Effect, Redacted } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { contentAddressRoutes, type ApiHandler } from '../index.ts';
import { call } from '../testing/api-calls.ts';
import { operationsIn } from '../testing/openapi/openapi-document.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

const key = Redacted.make(new Uint8Array(32).fill(5));

const alpha = { org: 'acme', playbook: 'alpha' };

const signedAt = 1_800_000_000;

const now = () => signedAt * 1000;

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>parent.postMessage("ran", "*")</script></svg>';

interface Asked {
  readonly method: string;
  readonly path: string;
}

interface Policies {
  readonly resource: string | null;
  readonly sandboxed: boolean;
}

function concretePathOf(path: string): string {
  return `/v1${path
    .replace('{org}', 'acme')
    .replace('{playbook}', 'alpha')
    .replaceAll(/\{\w+\}/gu, 'x')}`;
}

async function policiesAt(handler: ApiHandler, { method, path }: Asked): Promise<Policies> {
  const signal = AbortSignal.timeout(500);
  const answer = await handler.fetch(new Request(`http://localhost${path}`, { method, headers: asAdmin, signal }));
  await answer.body?.cancel();
  const directives = (answer.headers.get('content-security-policy') ?? '').split(';').map((each) => each.trim());
  return { resource: answer.headers.get('cross-origin-resource-policy'), sandboxed: directives.includes('sandbox') };
}

const pathsOutsideTheDocument: readonly Asked[] = [
  '/health',
  '/.well-known/api-catalog',
  '/nowhere',
  '/orgs/acme/mcp',
  '/orgs/acme/playbooks/alpha/mcp',
].map((path) => ({ method: 'GET', path }));

async function servingTheContent() {
  const content = memoryRecordedContent();
  const { sha256 } = await Effect.runPromise(content.put(alpha, textToKeep(svg, 'image/svg+xml')));
  const signed = contentAddressesUnder(key, now).signedContentAddress('http://localhost', alpha, sha256, signedAt + 60);
  const server = await operationServer({ routes: [contentAddressRoutes({ key, content, now })] });
  onTestFinished(() => server.runtime.dispose());
  const documented = operationsIn((await call(server.handler, '/v1/openapi.json')).body);
  const askedOf = (whether: boolean): readonly Asked[] =>
    documented
      .filter(({ operation }) => (operation.operationId === 'get_content') === whether)
      .map(({ method, path }) => ({ method: method.toUpperCase(), path: concretePathOf(path) }));
  const { pathname, search } = new URL(String(signed));
  return {
    handler: server.handler,
    content: [{ method: 'GET', path: `${pathname}${search}` }, ...askedOf(true)],
    others: askedOf(false),
  };
}

describe('the policies of the answers of the API', () => {
  it('let a page of another origin embed what the content path answers, signed or refused, sandboxed so that it runs nothing, and keep every other path to its own origin, unsandboxed', async () => {
    const { handler, content, others } = await servingTheContent();
    const elsewhere = [...others, ...pathsOutsideTheDocument];

    const embedded = await Promise.all(content.map((asked) => policiesAt(handler, asked)));
    const kept = await Promise.all(elsewhere.map((asked) => policiesAt(handler, asked)));

    expect(embedded).toEqual([
      { resource: 'cross-origin', sandboxed: true },
      { resource: 'cross-origin', sandboxed: true },
    ]);
    expect(new Set(kept.map((policies) => JSON.stringify(policies)))).toEqual(
      new Set([JSON.stringify({ resource: 'same-origin', sandboxed: false })]),
    );
    expect(elsewhere.length).toBeGreaterThan(10);
  });

  it("answers the content path's whole policy: nothing loaded, framed by no page, and sandboxed", async () => {
    const { handler, content } = await servingTheContent();
    const [signed] = content;

    const answer = await handler.fetch(new Request(`http://localhost${String(signed?.path)}`));

    expect([answer.status, answer.headers.get('content-security-policy'), await answer.text()]).toEqual([
      200,
      "default-src 'none'; frame-ancestors 'none'; sandbox",
      svg,
    ]);
  });
});
