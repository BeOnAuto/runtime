import { problemOf, problemResponse } from './problem.ts';

export function badRequestHandler(): Response {
  return problemResponse(problemOf('bad_request', 'The request could not be read'));
}
