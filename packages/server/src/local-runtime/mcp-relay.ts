import { SdkHttpError } from '@modelcontextprotocol/client';
import {
  isJSONRPCErrorResponse,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  parseJSONRPCMessage,
  type Transport,
} from '@modelcontextprotocol/server';

export type Timer = (milliseconds: number, then: () => void) => () => void;

export interface Relaying {
  readonly agent: () => Transport;
  readonly runtime: () => Transport;
  readonly recover: () => Promise<string | undefined>;
  readonly answering: () => Promise<boolean>;
  readonly timer: Timer;
  readonly report: (line: string) => void;
}

export const answerAwaitedMs = 5000;

export const recoveryAwaitedMs = 45_000;

const internalError = -32_603;

const unauthenticated = 401;

const unanswered = new Error('Auto Runtime did not answer');

const cutOff = new Error('Auto Runtime stopped before it answered');

const lostOnTheWay: ReadonlySet<unknown> = new Set([unanswered, cutOff]);

export const mayHaveTakenEffect =
  'Auto Runtime stopped answering while it had this request, and runs again now; check whether the request took effect before you send it again';

export const stillComing =
  'Auto Runtime is not answering yet, as it is being started or restarted; send the request again in a few seconds';

const repeatable: ReadonlySet<string> = new Set([
  'initialize',
  'ping',
  'tools/list',
  'prompts/list',
  'prompts/get',
  'resources/list',
  'resources/templates/list',
  'resources/read',
  'completion/complete',
]);

type Delivery = { readonly delivered: true } | { readonly delivered: false; readonly failure: unknown };

type Loss = 'never arrived' | 'may have arrived' | 'answered';

function couldNotConnect(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'syscall' in cause && cause.syscall === 'connect';
}

function neverArrived(failure: unknown): boolean {
  return (
    (failure instanceof TypeError && couldNotConnect(failure.cause)) ||
    (failure instanceof SdkHttpError && failure.status === unauthenticated)
  );
}

function lossOf(failure: unknown): Loss {
  if (neverArrived(failure)) {
    return 'never arrived';
  }
  return lostOnTheWay.has(failure) || failure instanceof TypeError ? 'may have arrived' : 'answered';
}

function isRepeatable(message: unknown): boolean {
  return !isJSONRPCRequest(message) || repeatable.has(message.method);
}

function idOf(message: unknown): unknown {
  return isJSONRPCRequest(message) ? message.id : undefined;
}

class McpRelay {
  readonly #agent: Transport;
  readonly #runtime: Transport;
  readonly #relaying: Relaying;
  readonly #initializing = new Set<unknown>();
  readonly #awaited = new Set<unknown>();
  readonly #ended = Promise.withResolvers<void>();
  #recovering: Promise<string | undefined> | undefined;

  constructor(relaying: Relaying) {
    this.#agent = relaying.agent();
    this.#runtime = relaying.runtime();
    this.#relaying = relaying;
  }

  async run(): Promise<void> {
    Object.assign(this.#runtime, {
      onmessage: (message: unknown) => {
        this.#answered(message);
      },
      onerror: (error: Readonly<Error>) => {
        this.#relaying.report(error.message);
      },
    });
    Object.assign(this.#agent, {
      onmessage: (message: unknown) => {
        void this.#forwarded(message);
      },
      onerror: (error: Readonly<Error>) => {
        this.#relaying.report(error.message);
      },
      onclose: () => {
        this.#ended.resolve();
      },
    });
    await this.#runtime.start();
    await this.#agent.start();
    await this.#ended.promise;
    await this.#runtime.close();
  }

  #answered(message: unknown): void {
    if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
      this.#awaited.delete(message.id);
    }
    if (isJSONRPCResultResponse(message) && this.#initializing.delete(message.id)) {
      const { protocolVersion } = message.result;
      if (typeof protocolVersion === 'string') {
        this.#runtime.setProtocolVersion?.(protocolVersion);
      }
    }
    void this.#agent.send(parseJSONRPCMessage(message));
  }

  async #forwarded(message: unknown): Promise<void> {
    if (isJSONRPCRequest(message) && message.method === 'initialize') {
      this.#initializing.add(message.id);
    }
    const lost = (failure: unknown) => this.#afterALoss(message, failure);
    const delivery = await this.#delivered(message, lost);
    if (!delivery.delivered) {
      await lost(delivery.failure);
    }
  }

  async #afterALoss(message: unknown, failure: unknown): Promise<void> {
    const loss = lossOf(failure);
    if (loss === 'answered') {
      await this.#refused(message, String(failure));
      return;
    }
    const problem = await this.#recovered();
    if (problem !== undefined) {
      await this.#refused(message, problem);
      return;
    }
    if (loss === 'may have arrived' && !isRepeatable(message)) {
      await this.#refused(message, mayHaveTakenEffect);
      return;
    }
    const lostAgain = (again: unknown) => this.#refused(message, String(again));
    const again = await this.#delivered(message, lostAgain);
    if (!again.delivered) {
      await lostAgain(again.failure);
    }
  }

  async #delivered(message: unknown, lost: (failure: unknown) => Promise<void>): Promise<Delivery> {
    const id = idOf(message);
    const givingUp = new AbortController();
    const stopWatching = this.#watched(givingUp);
    if (id !== undefined) {
      this.#awaited.add(id);
    }
    try {
      await this.#runtime.send(parseJSONRPCMessage(message), {
        requestSignal: givingUp.signal,
        onRequestStreamEnd: () => {
          if (this.#awaited.has(id)) {
            void lost(cutOff);
          }
        },
      });
      return { delivered: true };
    } catch (failure) {
      return { delivered: false, failure: givingUp.signal.aborted ? unanswered : failure };
    } finally {
      stopWatching();
    }
  }

  #watched(givingUp: AbortController): () => void {
    const watch = {
      on: true,
      cancel: this.#relaying.timer(answerAwaitedMs, () => {
        void check();
      }),
    };
    const check = async (): Promise<void> => {
      const answering = await this.#relaying.answering();
      if (!watch.on) {
        return;
      }
      if (!answering) {
        givingUp.abort();
        return;
      }
      watch.cancel = this.#relaying.timer(answerAwaitedMs, () => {
        void check();
      });
    };
    return () => {
      watch.on = false;
      watch.cancel();
    };
  }

  async #recovered(): Promise<string | undefined> {
    const recovering = (this.#recovering ??= this.#relaying
      .recover()
      .catch(String)
      .finally(() => {
        this.#recovering = undefined;
      }));
    const late = Promise.withResolvers<string>();
    const cancel = this.#relaying.timer(recoveryAwaitedMs, () => {
      late.resolve(stillComing);
    });
    try {
      return await Promise.race([recovering, late.promise]);
    } finally {
      cancel();
    }
  }

  async #refused(message: unknown, problem: string): Promise<void> {
    if (!isJSONRPCRequest(message)) {
      this.#relaying.report(`Auto Runtime did not take a message: ${problem}`);
      return;
    }
    this.#awaited.delete(message.id);
    await this.#agent.send({ jsonrpc: '2.0', id: message.id, error: { code: internalError, message: problem } });
  }
}

export function relay(relaying: Relaying): Promise<void> {
  return new McpRelay(relaying).run();
}
