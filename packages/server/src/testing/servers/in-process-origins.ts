type Fetch = typeof globalThis.fetch;

type Answer = (request: Request) => Promise<Response>;

const answering = new Map<string, Answer>();

const routing = { installed: false, lastPort: 0 };

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
 * An origin no listener is bound to, distinct within this test file: a server answering in the process takes it as
 * its own, and the global fetch hands each call to it to that server. A port the test sets is kept, as the address a
 * provider is told to send a person back to.
 */
export function inProcessOrigin(port = '0'): string {
  routing.lastPort += 1;
  return `http://127.0.0.1:${port === '0' ? routing.lastPort : port}`;
}

/**
 * Hands every global fetch of the origin to the answer, as a listener at that origin would, so a client that reaches
 * the server by its origin (an MCP client, a fetch of a link it answered) reaches it with no port. Returns the step
 * that stops it.
 */
export function answeredAt(origin: string, answer: Answer): () => void {
  if (!routing.installed) {
    globalThis.fetch = routedBeside(globalThis.fetch);
    routing.installed = true;
  }
  answering.set(origin, answer);
  return () => {
    answering.delete(origin);
  };
}
