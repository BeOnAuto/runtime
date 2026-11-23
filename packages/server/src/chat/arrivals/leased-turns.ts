import type { LeasedConversation } from '../store/leased-memory.ts';
import type { ConversationRow } from '../tables/chat-rows.ts';
import { turnTaken, type TurnSettled } from '../turn/chat-turn.ts';
import { modelOfATurn, type ChosenModel } from '../turn/turn-model.ts';
import { placeOf, whereOf, type Holding, type LeaseHolder, type ServingNow, type Taking } from './arrival-parts.ts';

export interface Leased {
  readonly person: string;
  readonly text: string;
  readonly autoNotNamed: boolean;
}

interface UnderTheLease {
  readonly taking: Taking;
  readonly leased: LeasedConversation;
  readonly chosen: ChosenModel;
  readonly asked: Leased;
  readonly answering: () => void;
}

function turnOfTheLease({ taking, leased, chosen, asked, answering }: UnderTheLease, serving: ServingNow) {
  const { message, connection } = taking;
  return turnTaken(
    { ...asked, where: whereOf(message), app: message.app, leased, answering },
    {
      service: connection.service,
      render: connection.render,
      chosen,
      directory: serving.directory,
      directoryUrl: serving.directoryUrl,
      holdsARole: serving.knowing.holdsARole,
      now: serving.now,
      waits: serving.waits,
      signal: serving.signal,
      notShownHere: connection.notShownHere,
      renewalFailed: serving.renewalFailed,
    },
  );
}

type Taken = { readonly holder: LeaseHolder; readonly leased: LeasedConversation } | { readonly not: 'busy' };

async function takenHere(conversation: ConversationRow, holding: Holding, serving: ServingNow): Promise<Taken> {
  const here = serving.holders.heldHere(conversation.id);
  if (here !== undefined) {
    if (here.holding === 'turn' || holding === 'check') {
      return { not: 'busy' };
    }
    await here.over;
    return takenHere(conversation, holding, serving);
  }
  const holder = serving.holders.held(conversation.id, holding);
  const lease = await serving.store.conversations.leaseTaken(conversation).catch((error: unknown) => {
    holder.released();
    throw error;
  });
  if ('running' in lease) {
    holder.released();
    return { not: 'busy' };
  }
  return { holder, leased: lease.leased };
}

export type Leasing = { readonly turned: TurnSettled } | { readonly not: 'busy' | 'no_model' };

export async function underTheLease(taking: Taking, asked: Leased, serving: ServingNow): Promise<Leasing> {
  const conversation = await serving.store.conversations.started(placeOf(taking.connection, taking.message));
  const taken = await takenHere(conversation, asked.autoNotNamed ? 'check' : 'turn', serving);
  if ('not' in taken) {
    return taken;
  }
  const { holder, leased } = taken;
  try {
    const model = await modelOfATurn(serving.models, taking.connection.model);
    if ('unavailable' in model) {
      return { not: 'no_model' };
    }
    const answering = holder.answering;
    return { turned: await turnOfTheLease({ taking, leased, chosen: model.chosen, asked, answering }, serving) };
  } finally {
    await leased.released().finally(holder.released);
  }
}
