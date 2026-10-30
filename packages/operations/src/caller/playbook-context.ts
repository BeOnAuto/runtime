import { Context } from 'effect';

export interface PlaybookAddress {
  readonly org: string;
  readonly playbook: string;
}

export class PlaybookContext extends Context.Service<PlaybookContext, PlaybookAddress>()(
  '@on.auto/operations/PlaybookContext',
) {}
