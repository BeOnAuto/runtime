import { guideMediaType } from '../guides/guide-resources.ts';
import type { GuideShelf } from '../guides/guide-shelf.ts';
import { guideArgumentDescription, guideToolDescription, guideToolName } from '../guides/guide-tool.ts';
import { guidesTag } from './operation-tags.ts';
import type { OpenApiObject } from './problem-responses.ts';

export const guidePath = '/guides/{guide}';

export function guidePathItemOf({ everyGuide }: GuideShelf): OpenApiObject {
  const named = everyGuide.map(({ name, title }) => `${name} (${title})`).join(', ');
  const get = {
    operationId: guideToolName,
    summary: 'Get guide',
    description: guideToolDescription,
    tags: [guidesTag],
    parameters: [
      {
        name: 'guide',
        in: 'path',
        required: true,
        description: `${guideArgumentDescription}; one of ${named}`,
        schema: { type: 'string', enum: everyGuide.map(({ name }) => name) },
      },
    ],
    responses: {
      200: {
        description: 'The whole text of the guide, in Markdown',
        content: { [guideMediaType]: { schema: { type: 'string' } } },
      },
    },
    security: [],
  };
  return { get };
}
