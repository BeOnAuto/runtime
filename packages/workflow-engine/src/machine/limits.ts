export const mostHeldBytes = 4_194_304;

export const taskFrameBytes = 4096;

export const mostInlineHeldValueBytes = 16_384;

export const mostEventBytes = 1_572_864;

export const mostRecordedRunBytes = 1_048_576;

export const mostOutputBytes = mostRecordedRunBytes - JSON.stringify({}).length;

export const mostCallArgumentsBytes = 1_056_768;

export const mostTasksPerInput = 100;

export const mostStepsWithoutWaiting = 10_000;

export const mostExpressionWork = 250;

export const mostWorkPerInput = 500;

export const mostValueWork = 8_000_000;

export const mostInputs = 100_000;

export const mostHistoryBytes = 536_870_912;

export const mostEventIdLength = 256;

export const mostWaitingEvents = 64;

export const mostWaitingEventBytes = 1_048_576;

export const mostReceivedEvents = 1024;

export const mostReceivedEventBytes = 4_194_304;

export const mostEmittedEvents = 1024;

export const mostEmittedEventBytes = 4_194_304;

export const mostEmittedEventSize = 245_760;

export const firstAdmissionWaitMs = 60_000;

export const longestAdmissionWaitMs = 3_600_000;

export const mostAdmissionWaitMs = 86_400_000;
