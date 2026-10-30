import { Context } from 'effect';

export interface OrgAddress {
  readonly org: string;
}

export class OrgContext extends Context.Service<OrgContext, OrgAddress>()('@on.auto/operations/OrgContext') {}
