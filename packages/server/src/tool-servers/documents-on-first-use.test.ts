import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { configuredServer } from '../testing/processes/configured-server.ts';
import { request } from '../testing/servers/http-client.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';

const billingDocument = JSON.stringify({
  openapi: '3.1.0',
  info: { title: 'Billing', version: '1' },
  servers: [{ url: 'https://billing.example.com' }],
  paths: {
    '/invoices': {
      get: { operationId: 'list_invoices', summary: 'Lists the invoices', responses: { '200': { description: 'ok' } } },
    },
  },
});

const refused =
  'tool_server_document_refused: The documents of the tool servers could not be read. TOOL_SERVERS: /billing/document: The document does not exist';

const search = `${alpha}/tool-servers/search?terms=invoices`;

describe('the document of an openapi server', () => {
  it('is read when a request first needs the tool servers; a document that cannot be read fails that request, naming its entry, and is read again on the next', async () => {
    const { child, configFile } = configuredServer(
      'tool_servers:\n  billing:\n    document: billing.json\n    org: acme\n',
      {},
    );
    const document = join(dirname(configFile), 'billing.json');
    const port = await child.port;
    await request(port, 'POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

    const missing = await request(port, 'GET', search);
    writeFileSync(document, billingDocument);
    const read = await request(port, 'GET', search);
    rmSync(document);
    const kept = await request(port, 'GET', search);
    child.signal('SIGTERM');
    await child.exited;
    const incident = /urn:uuid:(?<id>[\da-f-]+)/u.exec(missing.text)?.groups?.['id'];
    const logged = child
      .output()
      .stderr.split('\n')
      .filter((line) => line.includes(refused));

    expect({
      statuses: [missing.status, read.status, kept.status],
      logged: logged.map((line) => line.includes(`"incident":"${String(incident)}"`)),
      found: [read.text.includes('"tool":"list_invoices"'), kept.text === read.text],
    }).toEqual({ statuses: [500, 200, 200], logged: [true], found: [true, true] });
  });
});
