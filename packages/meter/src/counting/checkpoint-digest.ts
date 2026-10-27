import { createHash } from 'node:crypto';

export interface Counted {
  readonly actions: number;
  readonly through: readonly string[] | undefined;
  readonly last: string | undefined;
}

export interface Pointed {
  readonly actions: number;
  readonly through: readonly string[];
  readonly last: string;
}

export function digestOf({ actions, through, last }: Pointed): string {
  return createHash('sha256')
    .update(JSON.stringify([actions, through, last]))
    .digest('hex');
}
