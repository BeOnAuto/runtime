import { guideMediaType } from '../guides/guide-resources.ts';
import { guidePathOf } from '../guides/guide-routes.ts';
import type { GuideShelf } from '../guides/guide-shelf.ts';
import { openApiPath } from '../openapi/openapi-routes.ts';
import { versionPrefix } from '../operations/route-table.ts';
import type { RegisterRoutes } from '../routes.ts';
import { answerOf, cachedAnswerOf } from './cached-answer.ts';
import { apiCatalogLinkTo, apiCatalogPath, healthPath, publicOriginOf } from './public-addresses.ts';

const apiCatalogMediaType = 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';

function linksetOf(origin: string, { everyGuide }: GuideShelf): object {
  const api = `${origin}${versionPrefix}`;
  return {
    linkset: [
      { anchor: `${origin}${apiCatalogPath}`, item: [{ href: api }] },
      {
        anchor: api,
        'service-desc': [{ href: `${origin}${openApiPath}`, type: 'application/json' }],
        'service-doc': everyGuide.map((guide) => ({
          href: `${origin}${guidePathOf(guide)}`,
          type: guideMediaType,
          title: guide.title,
        })),
        status: [{ href: `${origin}${healthPath}` }],
      },
    ],
  };
}

export function apiCatalogRoutes(shelf: GuideShelf): RegisterRoutes {
  return (routes) => {
    routes.addPublic('GET', apiCatalogPath, (c) => {
      const origin = publicOriginOf(c, routes.resource);
      const catalog = cachedAnswerOf(JSON.stringify(linksetOf(origin, shelf)), apiCatalogMediaType, {
        link: apiCatalogLinkTo(`${origin}${apiCatalogPath}`),
      });
      return answerOf(c, catalog);
    });
  };
}
