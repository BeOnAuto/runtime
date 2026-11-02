import { Conflict, NotFound, type Context, type Decider } from '@on.auto/operations';
import { Result } from 'effect';

import type { About } from '../document/memory-bounds.ts';
import { MemoryFactSchema, type MemoryFact, type RecordedMemoryFact } from './memory-fact-schema.ts';
import type { MovedFrom, MovedTo, RememberedData } from './memory-facts.ts';
import { destinationInWords, scopeInWords, type MemoryAt } from './memory-streams.ts';

export type MemoryStatus = 'kept' | 'forgotten' | 'erased' | 'moved';

interface KeptText {
  readonly position: number;
  readonly data: RememberedData;
}

export interface MemoryState {
  readonly facts: number;
  readonly status: MemoryStatus | undefined;
  readonly version: number;
  readonly latest: RememberedData | undefined;
  readonly withText: readonly KeptText[];
  readonly moved: MovedTo | undefined;
  readonly movedFrom: MovedFrom | undefined;
}

export interface AskedMemory {
  readonly text: string;
  readonly tags: readonly string[];
  readonly about?: About;
  readonly expiresAt?: string;
  readonly movedFrom?: MovedFrom;
}

interface Asking {
  readonly at: MemoryAt;
  readonly context: Context;
}

interface Remembering extends Asking {
  readonly kind: 'remember';
  readonly memory: AskedMemory;
  readonly replaces: boolean;
}

interface Forgetting extends Asking {
  readonly kind: 'forget';
}

interface Moving extends Asking, MovedTo {
  readonly kind: 'move';
}

export type MemoryCommand = Remembering | Forgetting | Moving;

type Decision = Result.Result<readonly MemoryFact[], NotFound | Conflict>;

const noMemory: MemoryState = {
  facts: 0,
  status: undefined,
  version: 0,
  latest: undefined,
  withText: [],
  moved: undefined,
  movedFrom: undefined,
};

function evolved(state: MemoryState, fact: RecordedMemoryFact): MemoryState {
  const counted = { ...state, facts: state.facts + 1 };
  if (fact.type === 'memory_remembered') {
    const { data } = fact;
    const movedFrom = data.moved_from ?? state.movedFrom;
    return data.text === null
      ? { ...counted, status: 'erased', version: data.version, latest: undefined, movedFrom }
      : {
          ...counted,
          status: 'kept',
          version: data.version,
          latest: data,
          withText: [...state.withText, { position: counted.facts, data }],
          movedFrom,
        };
  }
  if (fact.type === 'memory_moved') {
    return { ...counted, status: 'moved', moved: fact.data };
  }
  const ended = fact.type === 'memory_erased' ? 'erased' : 'forgotten';
  return fact.data.version === state.version ? { ...counted, status: ended } : counted;
}

const refusedBecause: Readonly<Record<MemoryCommand['kind'], string>> = {
  remember: 'no new version can replace it',
  forget: 'forget the memory it was moved as',
  move: 'it cannot be moved',
};

function standingRefusal({ at, kind }: MemoryCommand, { status, moved }: MemoryState): NotFound | Conflict {
  const { id, scope } = at;
  if (status === undefined) {
    return new NotFound({ detail: `There is no memory ${id} among ${scopeInWords(scope)}` });
  }
  const standing = moved === undefined ? `was ${status}` : `was moved to ${destinationInWords(moved)} as ${moved.as}`;
  return new Conflict({ detail: `The memory ${id} ${standing}, so ${refusedBecause[kind]}` });
}

function rememberedOf({ memory, replaces }: Remembering, { version }: MemoryState): MemoryFact {
  const { text, tags, about, expiresAt, movedFrom } = memory;
  return {
    type: 'memory_remembered',
    data: {
      version: replaces ? version + 1 : 1,
      text,
      tags,
      ...(about === undefined ? {} : { about }),
      ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
      ...(replaces ? { replaces_version: version } : {}),
      ...(movedFrom === undefined ? {} : { moved_from: movedFrom }),
    },
  };
}

function rememberDecision(command: Remembering, state: MemoryState): Decision {
  if (command.replaces) {
    return state.status === 'kept'
      ? Result.succeed([rememberedOf(command, state)])
      : Result.fail(standingRefusal(command, state));
  }
  if (state.status === undefined) {
    return Result.succeed([rememberedOf(command, state)]);
  }
  return command.memory.movedFrom === undefined
    ? Result.fail(new Conflict({ detail: `The memory ${command.at.id} is kept already` }))
    : Result.succeed([]);
}

function forgetDecision(command: Forgetting, state: MemoryState): Decision {
  if (state.status === 'kept' || state.facts === 0) {
    return Result.succeed([{ type: 'memory_forgotten', data: { version: state.version } }]);
  }
  return state.status === 'forgotten' || state.status === 'erased'
    ? Result.succeed([])
    : Result.fail(standingRefusal(command, state));
}

function destinationOf({ to, as, playbook }: Moving): MovedTo {
  return playbook === undefined ? { to, as } : { to, as, playbook };
}

function movedThereAlready({ moved }: MemoryState, command: Moving): boolean {
  return moved?.as === command.as && moved.playbook === command.playbook;
}

function moveDecision(command: Moving, state: MemoryState): Decision {
  if (state.status === 'kept') {
    return Result.succeed([{ type: 'memory_moved', data: destinationOf(command) }]);
  }
  return movedThereAlready(state, command) ? Result.succeed([]) : Result.fail(standingRefusal(command, state));
}

function decided(command: MemoryCommand, state: MemoryState): Decision {
  if (command.kind === 'remember') {
    return rememberDecision(command, state);
  }
  return command.kind === 'forget' ? forgetDecision(command, state) : moveDecision(command, state);
}

export const memoryDecider: Decider<MemoryState, MemoryCommand, RecordedMemoryFact, 'not_found' | 'conflict'> = {
  initialState: noMemory,
  evolve: evolved,
  eventSchema: MemoryFactSchema,
  decide: decided,
  context: ({ context }) => context,
};
