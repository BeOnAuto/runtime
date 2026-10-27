export interface ClockSamples {
  readonly wallTime: () => number;
  readonly monotonicTime: () => number;
}

export interface TrustedTime {
  readonly id: string;
  readonly serverTime: number;
}

export interface ObservedTime extends TrustedTime {
  readonly monotonic: number;
}

export interface LicenseTime {
  readonly now: number;
  readonly onlineRequired: boolean;
}

export interface LicenseClock {
  readonly read: () => Promise<LicenseTime>;
  readonly synchronize: (fresh: TrustedTime) => Promise<LicenseTime>;
}

export interface ClockRow {
  readonly revision: number;
  readonly epoch: number;
  readonly trustId: string;
  readonly serverAnchor: number;
  readonly wallAnchor: number;
  readonly highWater: number;
  readonly wallSeen: number;
  readonly onlineRequired: boolean;
}

export interface ClockEstimate extends LicenseTime {
  readonly wall: number;
}

export interface ClockSample {
  readonly wall: number;
  readonly monotonic: number;
}
