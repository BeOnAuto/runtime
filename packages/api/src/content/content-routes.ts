import type { ContentOwner, RecordedContent, StreamedContent } from '@on.auto/content';
import {
  contentAddressesUnder,
  contentAddressLastsSeconds,
  type ContentAddressCheck,
  type ContentAddressKey,
  type ContentSignature,
} from '@on.auto/identity';
import { Effect } from 'effect';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { pathMatcherOf } from '../middleware/public-paths.ts';
import { versionPrefix } from '../operations/route-table.ts';
import type { Problem } from '../problem/problem-document.ts';
import { problemOf, problemResponse } from '../problem/problem.ts';
import type { RegisterRoutes } from '../routes.ts';

export interface ContentAddressServing {
  readonly key: ContentAddressKey;
  readonly content: Pick<RecordedContent, 'get'>;
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

const notHeld = problemOf('not_found', 'The playbook holds no content under this digest');

interface Answering {
  readonly secondsLeft: number;
  readonly headOnly: boolean;
}

async function contentAnswer(
  { stream, bytes, mediaType }: StreamedContent,
  { secondsLeft, headOnly }: Answering,
): Promise<Response> {
  const headers = {
    'content-type': mediaType,
    'content-length': String(bytes),
    'cache-control': `private, max-age=${secondsLeft}`,
  };
  if (headOnly) {
    await stream.cancel();
    return new Response(null, { headers });
  }
  return new Response(stream, { headers });
}

function addressedIn(c: Context<ApiEnv>): { readonly playbook: ContentOwner; readonly sha256: string } {
  return {
    playbook: { org: String(c.req.param('org')), playbook: String(c.req.param('playbook')) },
    sha256: String(c.req.param('sha256')),
  };
}

export function contentAddressRoutes({ key, content, now = Date.now }: ContentAddressServing): RegisterRoutes {
  const { checkedAddress } = contentAddressesUnder(key, now);
  const answered = async (c: Context<ApiEnv>): Promise<Response> => {
    const { playbook, sha256 } = addressedIn(c);
    const presented: ContentSignature = { until: c.req.query('until'), sig: c.req.query('sig') };
    const until = String(presented.until);
    const checked = checkedAddress(playbook, sha256, presented);
    if (checked !== 'signed') {
      return problemResponse(refusals[checked](until));
    }
    const answering = {
      secondsLeft: Math.min(contentAddressLastsSeconds, Math.max(0, Number(until) - Math.floor(now() / 1000))),
      headOnly: c.req.method === 'HEAD',
    };
    const kept = await Effect.runPromise(content.get(playbook, sha256));
    return kept === undefined ? problemResponse(notHeld) : contentAnswer(kept, answering);
  };
  return (routes) => {
    routes.addPublic('GET', contentRoutePath, answered);
  };
}
