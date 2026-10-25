import type { LanguageModel as SdkLanguageModel } from 'ai';

export type SdkModel = Exclude<SdkLanguageModel, string>;

export type ModelFactory = (modelId: string) => SdkModel;

export type Fetch = typeof globalThis.fetch;
