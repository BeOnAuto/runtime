export type Stopped = 'deadline' | 'memory' | 'busy' | 'cancelled' | 'closing';

export type Interrupted =
  | { readonly ran: 'stopped'; readonly because: Stopped }
  | { readonly ran: 'crashed'; readonly detail: string };

export type Ending<Answer> = Answer | Interrupted;

export function stopped(because: Stopped): Interrupted {
  return { ran: 'stopped', because };
}

export function crashed(detail: string): Interrupted {
  return { ran: 'crashed', detail };
}

export function isInterrupted<Answer extends { readonly ran: string }>(ending: Ending<Answer>): ending is Interrupted {
  return ending.ran === 'stopped' || ending.ran === 'crashed';
}
