import type { Fold, PlaybookAddress, PlaybookStatus, RecordedCaller, StreamReader } from '@on.auto/operations';
import { PlaybookEventSchema, playbooksStreamOfOrg } from '@on.auto/playbooks';
import { Effect } from 'effect';

export interface NoticedPlaybook {
  readonly status: PlaybookStatus;
  readonly owner?: RecordedCaller;
}

export type NoticedPlaybookOf = (address: PlaybookAddress) => Effect.Effect<NoticedPlaybook>;

type PlaybookFact = typeof PlaybookEventSchema.Type;

const unknownPlaybook: NoticedPlaybook = { status: 'unknown' };

function noticedAfter(noticed: NoticedPlaybook, fact: PlaybookFact): NoticedPlaybook {
  if (fact.type === 'playbook_created') {
    return { status: 'active', owner: fact.data.created_by };
  }
  if (fact.type === 'playbook_retired') {
    return { ...noticed, status: 'retired' };
  }
  return fact.type === 'playbook_restored' ? { ...noticed, status: 'active' } : noticed;
}

function noticedFoldOf(playbook: string): Fold<NoticedPlaybook, PlaybookFact> {
  return {
    initialState: unknownPlaybook,
    evolve: (noticed, fact) => (fact.data.playbook === playbook ? noticedAfter(noticed, fact) : noticed),
    eventSchema: PlaybookEventSchema,
  };
}

export function noticedPlaybookIn(reader: StreamReader): NoticedPlaybookOf {
  return ({ org, playbook }) =>
    Effect.map(reader.load(playbooksStreamOfOrg(org), noticedFoldOf(playbook)), ({ state }) => state);
}

export interface NoticedKeeping {
  readonly keptMs: number;
  readonly now: () => number;
}

interface KeptNotice {
  readonly noticed: NoticedPlaybook;
  readonly until: number;
}

export function noticedKeptOf(of: NoticedPlaybookOf, { keptMs, now }: NoticedKeeping): NoticedPlaybookOf {
  const kept = new Map<string, KeptNotice>();
  return (address) => {
    const key = `${address.org}/${address.playbook}`;
    const found = kept.get(key);
    if (found !== undefined && now() < found.until) {
      return Effect.succeed(found.noticed);
    }
    return Effect.map(of(address), (noticed) => {
      kept.set(key, { noticed, until: now() + keptMs });
      return noticed;
    });
  };
}
