import {
  contentAddressesUnder,
  contentAddressLastsSeconds,
  type ContentAddressCheck,
  type ContentAddressKey,
  type ContentSignature,
} from '@on.auto/identity';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { pathMatcherOf } from '../middleware/public-paths.ts';
import { versionPrefix } from '../operations/route-table.ts';
import type { Problem } from '../problem/problem-document.ts';
import { problemOf, problemResponse } from '../problem/problem.ts';
import type { RegisterRoutes } from '../routes.ts';
import { contentAnsweredAt, type Addressed, type ServedContent } from './content-answers.ts';

export interface ContentAddressServing {
  readonly key: ContentAddressKey;
  readonly content: ServedContent;
  readonly now?: () => number;
}

const contentRoutePath = `${versionPrefix}/orgs/:org/playbooks/:playbook/content/:sha256`;

export const servesContentAt = pathMatcherOf(contentRoutePath);

const refusals: Readonly<Record<Exclude<ContentAddressCheck, 'signed'>, (until: string) => Problem>> = {
  expired: (until) =>
    problemOf(
      'forbidden',
      `The address to this content expired at ${new Date(Number(until) * 1000).toISOString()}; ask for a new one`,
    ),
  not_for_this_content: () => problemOf('forbidden', 'The address is not one this runtime signed for this content'),
};

function addressedIn(c: Context<ApiEnv>): Addressed {
  return {
    playbook: { org: String(c.req.param('org')), playbook: String(c.req.param('playbook')) },
    sha256: String(c.req.param('sha256')),
  };
}

export function contentAddressRoutes({ key, content, now = Date.now }: ContentAddressServing): RegisterRoutes {
  const { checkedAddress } = contentAddressesUnder(key, now);
  const answered = (c: Context<ApiEnv>): Promise<Response> | Response => {
    const addressed = addressedIn(c);
    const presented: ContentSignature = { until: c.req.query('until'), sig: c.req.query('sig') };
    const until = String(presented.until);
    const checked = checkedAddress(addressed.playbook, addressed.sha256, presented);
    if (checked !== 'signed') {
      return problemResponse(refusals[checked](until));
    }
    return contentAnsweredAt(content, addressed, {
      secondsLeft: Math.min(contentAddressLastsSeconds, Math.max(0, Number(until) - Math.floor(now() / 1000))),
      headOnly: c.req.method === 'HEAD',
      range: c.req.header('range'),
    });
  };
  return (routes) => {
    routes.addPublic('GET', contentRoutePath, answered);
  };
}
