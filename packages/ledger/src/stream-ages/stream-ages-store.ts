export interface StreamAgesStore {
  readonly ageOfLastAppend: (stream: string) => Promise<number>;
  readonly lastPositionOf?: (stream: string) => Promise<number>;
}

export interface KeptStreamAges extends StreamAgesStore {
  readonly lastPositionOf: (stream: string) => Promise<number>;
}
