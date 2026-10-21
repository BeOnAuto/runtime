import {
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  parseJSONRPCMessage,
  type Transport,
} from '@modelcontextprotocol/server';

export interface Relaying {
  readonly agent: () => Transport;
  readonly runtime: () => Transport;
  readonly recover: () => Promise<string | undefined>;
  readonly report: (line: string) => void;
}

const internalError = -32_603;

type Sending = { readonly failed: false } | { readonly failed: true; readonly failure: unknown };

function couldNotConnect(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'syscall' in cause && cause.syscall === 'connect';
}

function neverWentOut(failure: unknown): boolean {
  return failure instanceof TypeError && couldNotConnect(failure.cause);
}

class McpRelay {
  readonly #agent: Transport;
  readonly #runtime: Transport;
  readonly #relaying: Relaying;
  readonly #initializing = new Set<unknown>();
  readonly #ended = Promise.withResolvers<void>();

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
    const sending = await this.#sent(message);
    if (!sending.failed) {
      return;
    }
    const problem = neverWentOut(sending.failure) ? await this.#sentAgain(message) : String(sending.failure);
    if (problem !== undefined) {
      await this.#refused(message, problem);
    }
  }

  async #sent(message: unknown): Promise<Sending> {
    try {
      await this.#runtime.send(parseJSONRPCMessage(message));
      return { failed: false };
    } catch (failure) {
      return { failed: true, failure };
    }
  }

  async #sentAgain(message: unknown): Promise<string | undefined> {
    const recovering = await this.#relaying.recover();
    if (recovering !== undefined) {
      return recovering;
    }
    const sending = await this.#sent(message);
    return sending.failed ? String(sending.failure) : undefined;
  }

  async #refused(message: unknown, problem: string): Promise<void> {
    if (!isJSONRPCRequest(message)) {
      this.#relaying.report(`Auto Runtime did not take a message: ${problem}`);
      return;
    }
    await this.#agent.send({ jsonrpc: '2.0', id: message.id, error: { code: internalError, message: problem } });
  }
}

export function relay(relaying: Relaying): Promise<void> {
  return new McpRelay(relaying).run();
}
