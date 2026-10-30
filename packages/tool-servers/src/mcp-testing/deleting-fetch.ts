import { Predicate } from 'effect';

export function fetchWithDeletion<Args extends readonly [unknown, unknown?]>(
  original: (...args: Args) => Promise<Response>,
  deleting: (request: unknown, sent: () => Promise<Response>) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return (...args) => {
    const [, request] = args;
    return Predicate.hasProperty(request, 'method') && request.method === 'DELETE'
      ? deleting(request, () => original(...args))
      : original(...args);
  };
}
