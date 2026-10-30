import type { McpServer } from '@modelcontextprotocol/server';

import type { Guide, GuideShelf } from './guide-shelf.ts';

type ResourceRegistry = Readonly<Pick<McpServer, 'registerResource'>>;

export const guideMediaType = 'text/markdown';

export function guideAddress({ name }: Pick<Guide, 'name'>): string {
  return `guide://${name}`;
}

export function serveGuideResources(server: ResourceRegistry, { everyGuide }: GuideShelf): void {
  for (const guide of everyGuide) {
    server.registerResource(
      guide.name,
      guideAddress(guide),
      {
        title: guide.title,
        description: guide.description,
        mimeType: guideMediaType,
        annotations: { audience: ['assistant'] },
      },
      () => ({ contents: [{ uri: guideAddress(guide), mimeType: guideMediaType, text: guide.text }] }),
    );
  }
}
