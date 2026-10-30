import { Context } from 'effect';

import type { LivePlaybookStatus } from '../ledger/playbook-registry.ts';

export class PlaybookLifecycle extends Context.Service<PlaybookLifecycle, { readonly status: LivePlaybookStatus }>()(
  '@on.auto/operations/PlaybookLifecycle',
) {}
