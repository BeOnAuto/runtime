import { Effect, type Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { servedDocumentAt } from '../api-testing/described-documents.ts';
import type { ToolServer } from '../listing/tool-server.ts';
import { describedAccess, playbookToolCalls, reportingAccess } from '../testing/index.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

type Paths = Readonly<Record<string, Schema.Json>>;

function queried(name: string): Schema.Json {
  return { name, in: 'query', schema: { type: 'string' } };
}

const paymentSummary = `Records a payment ${'with its amount and its date '.repeat(20)}`;

const billingPaths: Paths = {
  '/invoices/search': {
    get: { operationId: 'searchInvoices', summary: 'Finds invoices by customer.', parameters: [queried('customer')] },
  },
  '/invoices/{id}': {
    get: {
      operationId: 'getInvoice',
      summary: 'Reads one invoice. It answers the lines too.',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    },
  },
  '/customers': {
    get: {
      operationId: 'listCustomers',
      summary: 'Lists the customers, with the invoice each owes.',
      parameters: [queried('invoice')],
    },
  },
  '/ping': { get: { operationId: 'ping', summary: 'Answers when the API is up' } },
  '/payments': {
    post: {
      operationId: 'recordPayment',
      summary: paymentSummary,
      requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
    },
  },
};

function operationsCounted(count: number): Paths {
  const operations = Array.from({ length: count }, (_, index): readonly [string, Schema.Json] => [
    `/op${index + 1}`,
    { get: { operationId: `op${index + 1}`, summary: 'Reads one row.' } },
  ]);
  return Object.fromEntries(operations);
}

async function searching(paths: Paths, servers: readonly string[] = ['billing']) {
  const document = {
    openapi: '3.1.0',
    info: { title: 'Billing', version: '1' },
    servers: [{ url: 'https://billing.example.com/v1' }],
    paths,
  };
  const url = await servedDocumentAt(() => Promise.resolve(Response.json(document)));
  const entries = Object.fromEntries(servers.map((name) => [name, { document: url, org: 'acme' }]));
  const { access } = await describedAccess(entries);
  closing.push(access.close);
  const { call } = playbookToolCalls(access);
  return (input: Readonly<Record<string, unknown>>) => call('search', input);
}

function found(server: string, ...tools: readonly string[]): readonly unknown[] {
  return tools.map((tool): unknown => expect.objectContaining({ server, tool }));
}

const aHundredTools: unknown = expect.toSatisfy((tools: readonly unknown[]) => tools.length === 100);

describe('search with terms', () => {
  it('counts a word three in the name, split at case changes, two in an argument and one in the description', async () => {
    const search = await searching(billingPaths);

    expect(await search({ terms: 'invoice' })).toMatchObject({
      output: { tools: found('billing', 'getInvoice', 'listCustomers') },
    });
    expect(await search({ terms: 'customer invoices' })).toMatchObject({
      output: { tools: found('billing', 'searchInvoices') },
    });
  });

  it('answers tools of one score by name, and those of one name by server, splitting the words of the terms as names', async () => {
    const search = await searching(billingPaths, ['billing', 'ledger']);

    expect(await search({ terms: 'THE' })).toMatchObject({
      output: {
        tools: [
          ...found('billing', 'getInvoice'),
          ...found('ledger', 'getInvoice'),
          ...found('billing', 'listCustomers'),
          ...found('ledger', 'listCustomers'),
          ...found('billing', 'ping'),
          ...found('ledger', 'ping'),
        ],
      },
    });
    expect(await search({ terms: 'record_payment', only: 'write' })).toMatchObject({
      output: { tools: [...found('billing', 'recordPayment'), ...found('ledger', 'recordPayment')] },
    });
  });

  it('answers no tool when no word matches, and still names the servers it searched', async () => {
    const search = await searching(billingPaths);

    expect(await search({ terms: 'refund' })).toMatchObject({
      output: { servers: [{ name: 'billing', tool_count: 5 }], tools: [], scopes: ['billing'] },
    });
  });

  it('answers at most 100 tools, best first and then by name', async () => {
    const search = await searching(operationsCounted(101));

    const reads = await search({ terms: 'reads' });

    expect(await search({ terms: 'op1 op100' })).toMatchObject({ output: { tools: found('billing', 'op1', 'op100') } });
    expect(reads).toMatchObject({ output: { tools: aHundredTools } });
    expect(JSON.stringify(reads)).not.toContain('"op99"');
  });
});

function operation(operationId: string, summary: string, ...parameters: readonly string[]): Schema.Json {
  return { get: { operationId, summary, parameters: parameters.map((name) => queried(name)) } };
}

describe('the weights of a word of the terms', () => {
  it('rank a word in the name above one in an argument, and that above one in the description, whatever the names', async () => {
    const search = await searching({
      '/archive': operation('archive', 'Stores an invoice away.'),
      '/paid': operation('markPaid', 'Settles a bill.', 'invoice_id'),
      '/void': operation('voidInvoice', 'Cancels one.'),
    });

    expect(await search({ terms: 'invoice' })).toMatchObject({
      output: { tools: found('billing', 'voidInvoice', 'markPaid', 'archive') },
    });
  });

  it('make a word in an argument and in the description tie a word in the name, the tie answered by name', async () => {
    const search = await searching({
      '/add': operation('addInvoice', 'Opens one.'),
      '/notify': operation('notify', 'Tells a customer about an invoice.', 'invoice'),
      '/send': operation('sendInvoice', 'Mails one.'),
      '/tag': operation('tag', 'Labels an invoice.', 'invoice'),
      '/remind': operation('remind', 'Nudges a customer.', 'invoice'),
    });

    expect(await search({ terms: 'invoice' })).toMatchObject({
      output: { tools: found('billing', 'addInvoice', 'notify', 'sendInvoice', 'tag', 'remind') },
    });
  });
});

describe('a tool whose input schema names no argument', () => {
  it('is found by its name and its description alone', async () => {
    const { access } = reportingAccess({});
    const listed: ToolServer = {
      name: 'notes',
      type: 'stdio',
      record_content: true,
      playbooks: ['*'],
      provider: null,
      tools: [{ name: 'note_count', description: 'Counts the notes.', input_schema: { type: 'object' } }],
    };
    const { call } = playbookToolCalls({ ...access, listServers: () => Effect.succeed([listed]) });

    expect(await call('search', { terms: 'count notes' })).toMatchObject({
      output: { tools: [{ server: 'notes', tool: 'note_count', summary: 'Counts the notes.', read_only: false }] },
    });
  });
});

describe('the summary of a tool search finds', () => {
  it('is the first sentence of its description, at most 300 characters', async () => {
    const search = await searching(billingPaths);

    expect(await search({ terms: 'invoice' })).toMatchObject({
      output: {
        tools: [{ summary: 'Reads one invoice.' }, { summary: 'Lists the customers, with the invoice each owes.' }],
      },
    });
    expect(await search({ terms: 'ping' })).toMatchObject({
      output: { tools: [{ summary: 'Answers when the API is up' }] },
    });
    expect(await search({ terms: 'payment' })).toMatchObject({
      output: { tools: [{ summary: paymentSummary.slice(0, 300) }] },
    });
  });
});

describe('search without terms', () => {
  it('lists every tool while the servers offer at most 100 together', async () => {
    const search = await searching(operationsCounted(100));

    expect(await search({})).toMatchObject({
      output: { servers: [{ name: 'billing', tool_count: 100 }], tools: aHundredTools },
    });
  });

  it('lists the servers alone, each with its count of tools, when they offer more', async () => {
    const search = await searching(operationsCounted(101));

    expect(await search({})).toEqual({
      status: 'succeeded',
      output: {
        servers: [{ name: 'billing', type: 'openapi', record_content: true, provider: null, tool_count: 101 }],
        tools: [],
        scopes: ['billing'],
      },
    });
  });
});

const tooManyWords = 'Expected 1 to 8 words, separated by spaces';

describe('the terms of a search', () => {
  it('are refused at /terms when they hold no word, more than 8 words or a word over 64 characters', async () => {
    const search = await searching(billingPaths);
    const refusals = await Promise.all(
      [' ', 'a b c d e f g h i', `a ${'x'.repeat(65)}`].map((terms) => search({ terms })),
    );

    expect(refusals).toMatchObject([
      { reason: 'invalid_input', issues: [{ pointer: '/terms', detail: tooManyWords }] },
      { reason: 'invalid_input', issues: [{ pointer: '/terms', detail: tooManyWords }] },
      {
        reason: 'invalid_input',
        issues: [{ pointer: '/terms', detail: 'Expected words of at most 64 characters each' }],
      },
    ]);
    expect(await search({ terms: `a b c d e f g ${'x'.repeat(64)}` })).toMatchObject({ status: 'succeeded' });
  });
});
