export interface DeliveryBounds {
  readonly bodyBytes: number;
  readonly bodyWaitMs: number;
  readonly deliveriesOfAConnectionAMinute: number;
  readonly keptPastTheWindowSeconds: number;
}

export const deliveryBounds: DeliveryBounds = {
  bodyBytes: 256 * 1024,
  bodyWaitMs: 10_000,
  deliveriesOfAConnectionAMinute: 120,
  keptPastTheWindowSeconds: 60,
};
