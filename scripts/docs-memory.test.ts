import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const docs = resolve(import.meta.dirname, '../docs');

const routes = [...readFileSync(join(docs, 'nav.json'), 'utf8').matchAll(/"link"\s*:\s*"([^"]+)"/gu)]
  .map((match: readonly string[]) => match[1])
  .filter((route) => route !== undefined);

await test('memory functions are available in every runtime, with their format after that of lookup functions', () => {
  const functions = readFileSync(join(docs, 'concepts/functions.md'), 'utf8');
  const format = readFileSync(join(docs, 'reference/memory-format.md'), 'utf8');
  assert.ok(
    functions.includes('reasoning, lookup, memory, interaction, prediction and computation functions are available'),
  );
  assert.ok(functions.includes('](../reference/memory-format.md)'));
  assert.ok(routes.indexOf('/reference/lookup-format') < routes.indexOf('/reference/memory-format'));
  assert.ok(routes.indexOf('/reference/memory-format') < routes.indexOf('/reference/interaction-format'));
  assert.ok(format.includes('Memory functions are available in every runtime.'));
});

await test('the memory format sets out its history and what erasing reaches, and the reference of MCP lists its tools on /mcp and a playbook endpoint', () => {
  const format = readFileSync(join(docs, 'reference/memory-format.md'), 'utf8');
  const mcp = readFileSync(join(docs, 'reference/mcp.md'), 'utf8');
  assert.ok(format.includes('Erasing does not reach what runs recorded before it'));
  assert.ok(format.includes("the facts of the playbook's own memories are among its events"));
  assert.ok(
    mcp.includes(
      'These tools are listed on `/mcp` and a playbook endpoint. Their routes are relative to `/v1/orgs/{org}/playbooks/{playbook}`.',
    ),
  );
});
