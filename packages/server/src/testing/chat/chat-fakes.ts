import type { ChatModel, SendToDirectory, Wait, Waits } from '@on.auto/chat';
import type { Answering } from '@on.auto/chat/testing';
import type { WrittenInAThread } from '@on.auto/interaction';
import type { ModelRequest } from '@on.auto/reasoning';
import { Schema } from 'effect';

import type { ChatService, Posting, SenderRead, Shown, WhereWritten } from '../../chat/service/service-calls.ts';
import type { InProcessDirectory } from '../../chat/turn/in-process-directory.ts';
import type { ModelLimits, TurnModels } from '../../chat/turn/turn-model.ts';

interface Said {
  readonly call: 'answered' | 'replaced' | 'alone' | 'typing';
  readonly text?: string;
  readonly rendered?: Schema.Json;
  readonly where: WhereWritten;
}

function postedAs(posting: Posting): Pick<Said, 'text' | 'rendered'> {
  return typeof posting === 'string' ? { text: posting } : { text: posting.text, rendered: posting.payload };
}

export interface ServiceScript {
  readonly typing?: Shown;
  readonly sender?: SenderRead;
  readonly thread?: readonly WrittenInAThread[];
  readonly sent?: string;
  readonly replaces?: boolean;
  readonly alone?: boolean;
}

export interface ServiceFake {
  readonly service: ChatService;
  readonly said: readonly Said[];
  readonly calls: () => readonly Said['call'][];
  readonly firstAnswer: Promise<void>;
}

export function serviceFake(script: ServiceScript = {}): ServiceFake {
  const said: Said[] = [];
  const { promise: firstAnswer, resolve } = Promise.withResolvers<void>();
  const service: ChatService = {
    answered: (where, posting) => {
      said.push({ call: 'answered', ...postedAs(posting), where });
      resolve();
      return Promise.resolve(script.sent);
    },
    replaced: (where, _sent, text) => {
      said.push({ call: 'replaced', text, where });
      return Promise.resolve(script.replaces ?? true);
    },
    toldAlone: (where, posting) => {
      said.push({ call: 'alone', ...postedAs(posting), where });
      return Promise.resolve(script.alone ?? true);
    },
    thread: () => Promise.resolve(script.thread ?? []),
    sender: () => Promise.resolve(script.sender),
    typing: (where) => {
      said.push({ call: 'typing', where });
      return Promise.resolve(script.typing ?? 'shown');
    },
  };
  return { service, said, calls: () => said.map(({ call }) => call), firstAnswer };
}

export interface SteppedWaits {
  readonly waits: Waits;
  readonly asked: () => readonly number[];
  readonly elapse: () => Promise<void>;
  readonly stopped: () => number;
}

interface Pending {
  readonly ms: number;
  readonly resolve: () => void;
}

export function steppedWaits(): SteppedWaits {
  const pending: Pending[] = [];
  const stopped = new Set<Pending>();
  const waits: Waits = (ms): Wait => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const each = { ms, resolve };
    pending.push(each);
    return {
      elapsed: promise,
      stop: () => {
        stopped.add(each);
      },
    };
  };
  return {
    waits,
    asked: () => pending.map(({ ms }) => ms),
    elapse: async () => {
      const [first] = pending.splice(0, 1);
      first?.resolve();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    },
    stopped: () => pending.filter((each) => stopped.has(each)).length,
  };
}

/** The service, showing the working status once and failing as a defect would at each later call to show it. */
export function typingThatFailsAfterTheFirst(service: ChatService): ChatService {
  const shown = { times: 0 };
  return {
    ...service,
    typing: (where) => {
      shown.times += 1;
      return shown.times === 1 ? service.typing(where) : Promise.reject(new Error('a defect'));
    },
  };
}

/** The models, each call letting the oldest wait elapse first, so a renewal of the working status runs before the answer. */
export function answeredAfterAWait(models: TurnModels, stepped: SteppedWaits): TurnModels {
  return {
    ...models,
    generate: (model) => {
      const generate = models.generate(model);
      return async (request, signal) => {
        await stepped.elapse();
        return generate(request, signal);
      };
    },
  };
}

export interface ModelsScript {
  readonly refusal?: string;
  readonly limits?: ModelLimits;
  readonly answers?: readonly Answering[];
}

export interface ModelsFake {
  readonly models: TurnModels;
  readonly requests: readonly ModelRequest[];
}

export function modelsFake({ refusal, limits = {}, answers = [] }: ModelsScript = {}): ModelsFake {
  const requests: ModelRequest[] = [];
  const remaining = [...answers];
  const generate: ChatModel<never>['generate'] = (request) => {
    requests.push(request);
    const next = remaining.shift();
    return next === undefined ? Promise.reject(new Error('no answer scripted')) : Promise.resolve(next);
  };
  const models: TurnModels = {
    refusalOf: () => Promise.resolve(refusal),
    limitsOf: () => Promise.resolve(limits),
    generate: () => generate,
  };
  return { models, requests };
}

const askedOf = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ id: Schema.Union([Schema.String, Schema.Number]), method: Schema.String })),
);

const listing = [{ name: 'list_playbooks', description: 'Lists the playbooks.', inputSchema: { type: 'object' } }];

/** The server's directory of tools as a turn asks it: one tool listed, and every call answered with no playbooks. */
export const answeredAsTheDirectory: SendToDirectory = async (request) => {
  const { id, method } = askedOf(await request.text());
  const result =
    method === 'tools/list' ? { tools: listing } : { content: [{ type: 'text', text: '{"playbooks":[]}' }] };
  return Response.json({ jsonrpc: '2.0', id, result });
};

export interface DirectoryFake {
  readonly directory: InProcessDirectory;
  readonly callers: readonly string[];
}

export function directoryFake(failing = false): DirectoryFake {
  const callers: string[] = [];
  const directory: InProcessDirectory = {
    asking: (caller, _context, use) => {
      callers.push(caller.own.id);
      return use((request) =>
        failing ? Promise.resolve(new Response('', { status: 500 })) : answeredAsTheDirectory(request),
      );
    },
  };
  return { directory, callers };
}
