import type { Wait, Waits } from '@on.auto/chat';

import type { ChatService, Shown, WhereWritten } from '../service/service-calls.ts';

export const STATUS_RENEWAL_MS = 90_000;

export interface ShownNowhere {
  readonly has: () => boolean;
  readonly add: () => void;
}

export interface StatusParts {
  readonly service: ChatService;
  readonly working: string;
  readonly waits: Waits;
  readonly notShownHere: ShownNowhere;
  readonly renewalFailed: (cause: unknown) => void;
  readonly renewalMs?: number;
}

export interface StatusShown {
  readonly answered: (text: string) => Promise<void>;
}

interface Renewal {
  readonly stop: () => void;
}

function renewedEvery(
  { waits, renewalFailed, renewalMs = STATUS_RENEWAL_MS }: StatusParts,
  renew: () => Promise<Shown>,
): Renewal {
  const state: { stopped: boolean; wait: Wait | undefined } = { stopped: false, wait: undefined };
  const renewing = async (): Promise<void> => {
    state.wait = waits(renewalMs);
    await state.wait.elapsed;
    if (!state.stopped) {
      await renew();
      await renewing();
    }
  };
  void renewing().catch(renewalFailed);
  return {
    stop: () => {
      state.stopped = true;
      state.wait?.stop();
    },
  };
}

async function shownBy(where: WhereWritten, { service, notShownHere }: StatusParts): Promise<Shown> {
  if (notShownHere.has()) {
    return 'refused';
  }
  const shown = await service.typing(where);
  if (shown === 'refused') {
    notShownHere.add();
  }
  return shown;
}

export async function statusShownFor(where: WhereWritten, parts: StatusParts): Promise<StatusShown> {
  const { service } = parts;
  if ((await shownBy(where, parts)) === 'shown') {
    const renewal = renewedEvery(parts, () => service.typing(where));
    return {
      answered: async (text) => {
        renewal.stop();
        await service.answered(where, text);
      },
    };
  }
  const working = await service.answered(where, parts.working);
  return {
    answered: async (text) => {
      if (working === undefined || !(await service.replaced(where, working, text))) {
        await service.answered(where, text);
      }
    },
  };
}
