const minute = 60_000;

const day = 86_400_000;

const mebibyte = 1_048_576;

export const predictionBounds = {
  mostHorizons: 8,
  mostHorizon: 52,
  leastSeason: 2,
  mostSeason: 366,
  leastHoldout: 8,
  mostWindow: 1000,
  mostHistory: 500,
  mostFilters: 8,
  mostFeatures: 40,
  mostNameCharacters: 64,
  mostUnitCharacters: 64,
  mostRules: 32,
  mostRuleBytes: 256,
  leastShare: 0.5,
  mostShare: 0.99,
  coverageFloor: 0.7,
  confidence: 0.9,
  mostShadowPeriods: 52,
  shortestExpiryMs: minute,
  longestExpiryMs: 30 * day,
  mostSeriesBytes: 256,
  mostDatasetRows: 200_000,
  mostDatasetSeries: 1000,
  mostDatasetBytes: 64 * mebibyte,
  mostBriefBytes: 65_536,
  questionMs: 10_000,
  candidatesInABuild: 8,
  mostCandidateBytes: 64 * mebibyte,
  scoringACandidateMs: 10 * minute,
  buildStartMs: minute,
  mostFunctions: 32,
  datasetRebuildsAtOnce: 2,
  mostNotesAPage: 10,
} as const;

export const predictionDefinitionType = 'prediction';
