import { serveFakeMcp } from '../src/mcp-testing/fake-mcp-server.ts';

const fake = await serveFakeMcp({
  bearer: 'graph-api-key-4f1d9a7c2b',
  mostRequestBytes: 1_073_741_824,
  tools: [
    {
      name: 'save',
      description: 'Saves a page.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      answer: () => ({ content: [{ type: 'text', text: 'saved' }] }),
    },
  ],
});

process.send?.({ url: fake.url });
