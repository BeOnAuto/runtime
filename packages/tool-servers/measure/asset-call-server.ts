import { serveFakeMcp } from '../src/mcp-testing/fake-mcp-server.ts';

const fake = await serveFakeMcp({
  bearer: 'graph-api-key-4f1d9a7c2b',
  mostRequestBytes: 2_147_483_647,
  tools: [
    {
      name: 'save',
      description: 'Saves a page.',
      inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: [] },
      answer: () => ({ content: [{ type: 'text', text: 'saved' }] }),
    },
    {
      name: 'upload',
      description: 'Uploads a file.',
      inputSchema: {
        type: 'object',
        properties: { content: { type: 'string', contentEncoding: 'base64' } },
        required: [],
      },
      answer: () => ({ content: [{ type: 'text', text: 'uploaded' }] }),
    },
  ],
});

process.send?.({ url: fake.url });
