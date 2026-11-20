import { declaredValueIn, headerIn, textIn, type Arrival } from './arrival-readings.ts';
import type { Destination } from './destination-fields.ts';

export interface PresentedProof {
  readonly signature?: string;
  readonly timestamp?: string | number;
  readonly id?: string;
  readonly token?: string;
  readonly header?: (name: string) => string | undefined;
}

type Proof = NonNullable<Destination['verify']>;

type ProofPart = 'signature' | 'timestamp' | 'id' | 'token';

const proofParts: readonly ProofPart[] = ['signature', 'timestamp', 'id', 'token'];

function sendingTimeIn(arrival: Arrival, expression: string | undefined): string | number | undefined {
  const value = declaredValueIn(arrival, expression);
  return typeof value === 'number' || (typeof value === 'string' && value !== '') ? value : undefined;
}

function proofPartsIn(arrival: Arrival, verify: Proof): Pick<PresentedProof, ProofPart> {
  const signature = textIn(arrival, verify.signature);
  const timestamp = sendingTimeIn(arrival, verify.timestamp);
  const id = textIn(arrival, verify.id);
  const token = textIn(arrival, verify.token);
  return {
    ...(signature === undefined ? {} : { signature }),
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(id === undefined ? {} : { id }),
    ...(token === undefined ? {} : { token }),
  };
}

export function presentedProofOf({ verify }: Destination, arrival: Arrival): PresentedProof | undefined {
  if (verify === undefined || arrival.transport !== 'request') {
    return undefined;
  }
  const parts = proofPartsIn(arrival, verify);
  if (proofParts.some((part) => verify[part] !== undefined && parts[part] === undefined)) {
    return undefined;
  }
  const { headers } = arrival;
  return verify.scheme === 'standard-webhooks' ? { ...parts, header: (name) => headerIn(headers, name) } : parts;
}
