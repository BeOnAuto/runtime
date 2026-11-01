import { studioLinkOf } from '@on.auto/identity';
import { namesTheLoopback } from '@on.auto/operations';
import { StudioLinks, type StudioLinkTo } from '@on.auto/operations/studio-links';
import { Context } from 'effect';

import type { ApiOptions } from '../api-options.ts';
import { publicOriginOfRequest } from '../discovery/public-addresses.ts';
import { noContextOfTheCall, type CallContext } from '../routes.ts';

type LinkingStudio = Pick<ApiOptions, 'studio' | 'authenticator' | 'callContext'>;

function opensInStudio(origin: string): boolean {
  const { protocol, hostname } = new URL(origin);
  return protocol === 'https:' || namesTheLoopback(hostname);
}

function studioLinksAt({ studio, authenticator }: LinkingStudio, request: Request): StudioLinkTo | null {
  const ownOrigin = publicOriginOfRequest(request, authenticator.resource);
  return opensInStudio(ownOrigin)
    ? (page) => studioLinkOf(studio, { ownOrigin, openedFrom: 'agent', installId: undefined, page })
    : null;
}

export function callContextLinkingStudio(options: LinkingStudio): CallContext {
  const given = options.callContext ?? noContextOfTheCall;
  return (request) => Context.add(given(request), StudioLinks, studioLinksAt(options, request));
}
