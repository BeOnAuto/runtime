type Fetch = typeof globalThis.fetch;

type Answer = (request: Request) => Promise<Response>;

const answering = new Map<string, Answer>();

const routing: { routed: Fetch | undefined; lastPort: number } = { routed: undefined, lastPort: 0 };

/**
 * The request as a listener would hand it on: a fetch sends the Host header on the wire, so a request built in the
 * process carries none until it is given one.
 */
export function asSentTo(answer: Answer): Answer {
  return (request) => {
    const headers = new Headers(request.headers);
    headers.set('host', new URL(request.url).host);
    return answer(new Request(request, { headers }));
  };
}

function routedBeside(network: Fetch): Fetch {
  return (...given: readonly [unknown, unknown?]) => {
    const [address, init] = given;
    const asked = address instanceof Request ? address : String(address);
    const answer = answering.get(new URL(asked instanceof Request ? asked.url : asked).origin);
    const options: RequestInit = Object.assign({}, init);
    return answer === undefined ? network(asked, options) : answer(new Request(asked, options));
  };
}

/**
 * The ports an in-process origin takes: below 1024, where no listener of a test can bind, so an origin never takes
 * over a fake's port; and not 80 or 443, which a URL leaves out of the origin it names.
 */
const unboundPorts = Array.from({ length: 1023 }, (_, at) => at + 1).filter((port) => port !== 80 && port !== 443);

/**
 * An origin no listener is bound to, distinct among the servers of the process while fewer than a thousand run at
 * once: a server answering in the process takes it as its own, and the global fetch hands each call to it to that
 * server. A port the test sets is kept, as the address a provider is told to send a person back to.
 */
export function inProcessOrigin(port = '0'): string {
  routing.lastPort += 1;
  const unbound = String(unboundPorts[routing.lastPort % unboundPorts.length]);
  return `http://127.0.0.1:${port === '0' ? unbound : port}`;
}

/**
 * Hands every global fetch of the origin to the answer, as a listener at that origin would, so a client that reaches
 * the server by its origin (an MCP client, a fetch of a link it answered) reaches it with no port. Returns the step
 * that stops it. Where another file of the process put back a fetch of its own, the routing goes around that one.
 */
export function answeredAt(origin: string, answer: Answer): () => void {
  if (globalThis.fetch !== routing.routed) {
    routing.routed = routedBeside(globalThis.fetch);
    globalThis.fetch = routing.routed;
  }
  answering.set(origin, answer);
  return () => {
    answering.delete(origin);
  };
}
