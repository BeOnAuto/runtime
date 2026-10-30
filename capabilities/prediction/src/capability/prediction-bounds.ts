export const predictionBounds = {
  mostHorizons: 8,
  mostHorizon: 52,
  leastSeason: 2,
  mostSeason: 366,
  mostWindow: 1000,
  mostHistory: 500,
  mostFilters: 8,
  mostNameCharacters: 64,
  mostUnitCharacters: 64,
  leastCoverage: 0.5,
  mostCoverage: 0.95,
  coverage: 0.8,
  mostSeriesBytes: 256,
  questionMs: 10_000,
  mostFunctions: 32,
  datasetRebuildsAtOnce: 2,
  mostNotesAPage: 10,
} as const;

export const predictionDefinitionType = 'prediction';
