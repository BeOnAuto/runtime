import { createHash } from 'node:crypto';

const resamples = 1000;

type Draw = () => number;

function seededDraws(seed: number): Draw {
  const state = { value: seed >>> 0 };
  return () => {
    state.value = (state.value + 0x6d_2b_79_f5) >>> 0;
    let mixed = state.value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function seedOf(runId: string): number {
  return createHash('sha256').update(runId, 'utf8').digest().readUInt32BE(0);
}

const blocksASeasonNeeds = 3;

export function blockLengthOf(season: number | undefined, count: number): number {
  const fits = season !== undefined && season * blocksASeasonNeeds <= count;
  return Math.max(1, Math.min(count, fits ? season : Math.ceil(Math.cbrt(count))));
}

function resampledMean(differences: readonly number[], block: number, draw: Draw): number {
  const count = differences.length;
  let total = 0;
  let taken = 0;
  while (taken < count) {
    const start = Math.floor(draw() * (count - block + 1));
    for (let offset = 0; offset < block && taken < count; offset += 1) {
      total += Number(differences[start + offset]);
      taken += 1;
    }
  }
  return total / count;
}

export function pBetterOf(differences: readonly number[], season: number | undefined, seed: number): number {
  if (differences.length === 0) {
    return 0;
  }
  const block = blockLengthOf(season, differences.length);
  const draw = seededDraws(seed);
  let lower = 0;
  for (let resample = 0; resample < resamples; resample += 1) {
    if (resampledMean(differences, block, draw) < 0) {
      lower += 1;
    }
  }
  return lower / resamples;
}
