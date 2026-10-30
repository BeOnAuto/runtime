import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const docs = resolve(import.meta.dirname, '../docs');

await test('docs distinguish inbound MCP from the tools a reasoning function calls', () => {
  const mcp = readFileSync(join(docs, 'reference/mcp.md'), 'utf8');
  const functions = readFileSync(join(docs, 'concepts/functions.md'), 'utf8');
  assert.ok(mcp.includes('inbound interface'));
  assert.ok(mcp.includes('It does not configure tools inside a reasoning function'));
  assert.ok(mcp.includes("through tool servers the runtime's operator configures"));
  assert.ok(mcp.includes('never by adding an endpoint to an external agent'));
  assert.ok(functions.includes('Tool access is available wherever the runtime'));
  assert.ok(functions.includes('model gateways connect to language models'));
  assert.ok(
    functions.includes(
      "A reasoning function can call the tools of tool servers that the runtime's operator configures",
    ),
  );
  assert.ok(
    functions.includes("Connecting an external agent to Auto does not give the function access to that agent's tools"),
  );
  assert.ok(functions.includes('Skill references and a separately managed tool library are still planned'));
});

await test('reasoning guides retain tool-use limits and side-effect-aware retries', () => {
  const publicGuide = readFileSync(join(docs, 'reference/reasoning-format.md'), 'utf8');
  const engineeringGuide = readFileSync(join(docs, 'engineering/reference/reasoning-format.md'), 'utf8');
  for (const guide of [publicGuide, engineeringGuide]) {
    assert.ok(guide.includes('tools_unfinished'));
    assert.ok(guide.includes('tools_called'));
    assert.ok(guide.includes('25'));
    assert.ok(guide.includes('REASONING_MAX_INPUT_TOKENS'));
    assert.ok(guide.includes('16 KiB'));
  }
  assert.ok(publicGuide.includes('Inspect its history and any external effects'));
  assert.ok(publicGuide.includes('Retrying a successful run returns its recorded result'));
  assert.ok(engineeringGuide.includes('the run is interrupted and recorded as `failed`'));
  assert.equal(engineeringGuide.includes('interrupted and stays `started`'), false);
});

await test('the configuration of tool servers documents recording and credential boundaries', () => {
  const configuration = readFileSync(join(docs, 'self-host/configuration.md'), 'utf8');
  const http = readFileSync(join(docs, 'reference/http.md'), 'utf8');
  assert.ok(
    configuration.includes('Only `headers`, `query_params`, `security`, `env` and `auth` may hold a reference'),
  );
  assert.ok(configuration.includes('a value shorter than 8 characters is not'));
  assert.ok(configuration.includes('anyone who may read the playbook reads them'));
  assert.ok(http.includes('`tool_call_answered` when the tool answered'));
  assert.ok(http.includes('`tool_call_failed` when it never answered'));
  assert.ok(http.includes('unless the operator turns `record_content` off for the server'));
  assert.ok(http.includes('absence of an answer does not prove it was cancelled before acting'));
});
