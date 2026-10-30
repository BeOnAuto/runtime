const capabilities = {
  batch: { supported: true },
  citations: { supported: true },
  code_execution: { supported: true },
  context_management: {
    clear_thinking_20251015: { supported: true },
    clear_tool_uses_20250919: { supported: true },
    compact_20260112: { supported: true },
    supported: true,
  },
  effort: {
    high: { supported: true },
    low: { supported: true },
    max: { supported: true },
    medium: { supported: true },
    supported: true,
    xhigh: { supported: true },
  },
  image_input: { supported: true },
  pdf_input: { supported: true },
  structured_outputs: { supported: true },
  thinking: { supported: true, types: { adaptive: { supported: true }, enabled: { supported: true } } },
};

export const anthropicModels = {
  data: [
    {
      id: 'claude-sonnet-4-5-20250929',
      capabilities,
      created_at: '2025-09-29T00:00:00Z',
      display_name: 'Claude Sonnet 4.5',
      max_input_tokens: 200_000,
      max_tokens: 64_000,
      type: 'model',
    },
    {
      id: 'claude-haiku-4-5-20251001',
      capabilities,
      created_at: '2025-10-01T00:00:00Z',
      display_name: 'Claude Haiku 4.5',
      max_input_tokens: 200_000,
      max_tokens: 64_000,
      type: 'model',
    },
    {
      id: 'claude-opus-4-1-20250805',
      capabilities: null,
      created_at: '2025-08-05T00:00:00Z',
      display_name: 'Claude Opus 4.1',
      max_input_tokens: null,
      max_tokens: null,
      type: 'model',
    },
  ],
  first_id: 'claude-sonnet-4-5-20250929',
  has_more: false,
  last_id: 'claude-opus-4-1-20250805',
};

export const openAiModels = {
  object: 'list',
  data: [
    { id: 'gpt-5', object: 'model', created: 1_754_425_777, owned_by: 'system', shutdown_date: null },
    { id: 'gpt-5-mini', object: 'model', created: 1_754_425_928, owned_by: 'system', shutdown_date: null },
    { id: 'o3', object: 'model', created: 1_744_225_308, owned_by: 'system', shutdown_date: null },
    { id: 'gpt-4.1', object: 'model', created: 1_744_316_542, owned_by: 'system', shutdown_date: null },
    { id: 'text-embedding-3-small', object: 'model', created: 1_705_948_997, owned_by: 'system', shutdown_date: null },
    { id: 'whisper-1', object: 'model', created: 1_677_532_384, owned_by: 'openai-internal', shutdown_date: null },
    { id: 'tts-1-hd', object: 'model', created: 1_699_046_015, owned_by: 'system', shutdown_date: null },
    { id: 'gpt-4o-mini-tts', object: 'model', created: 1_742_403_959, owned_by: 'system', shutdown_date: null },
    { id: 'gpt-4o-transcribe', object: 'model', created: 1_742_068_463, owned_by: 'system', shutdown_date: null },
    { id: 'gpt-audio', object: 'model', created: 1_756_339_249, owned_by: 'system', shutdown_date: null },
    { id: 'dall-e-3', object: 'model', created: 1_698_785_189, owned_by: 'system', shutdown_date: null },
    { id: 'gpt-image-1', object: 'model', created: 1_745_517_030, owned_by: 'system', shutdown_date: null },
    { id: 'sora-2', object: 'model', created: 1_759_708_615, owned_by: 'system', shutdown_date: null },
    { id: 'omni-moderation-latest', object: 'model', created: 1_731_689_265, owned_by: 'system', shutdown_date: null },
    { id: 'gpt-realtime', object: 'model', created: 1_756_271_701, owned_by: 'system', shutdown_date: null },
    { id: 'babbage-002', object: 'model', created: 1_692_634_615, owned_by: 'system', shutdown_date: '2026-10-23' },
    {
      id: 'ft:gpt-4o-mini-2024-07-18:acme-corp::9xYz1234',
      object: 'model',
      created: 1_754_500_000,
      owned_by: 'user-a1b2c3d4e5',
      shutdown_date: null,
    },
  ],
};

export const geminiModels = {
  models: [
    {
      name: 'models/gemini-2.5-flash',
      version: '001',
      displayName: 'Gemini 2.5 Flash',
      description:
        'Stable version of Gemini 2.5 Flash, our mid-size multimodal model that supports up to 1 million tokens.',
      inputTokenLimit: 1_048_576,
      outputTokenLimit: 65_536,
      supportedGenerationMethods: ['generateContent', 'countTokens', 'createCachedContent', 'batchGenerateContent'],
      temperature: 1,
      topP: 0.95,
      topK: 64,
      maxTemperature: 2,
      thinking: true,
    },
    {
      name: 'models/gemini-embedding-001',
      version: '001',
      displayName: 'Gemini Embedding 001',
      description: 'Obtain a distributed representation of a text.',
      inputTokenLimit: 2048,
      outputTokenLimit: 1,
      supportedGenerationMethods: ['embedContent', 'countTextTokens', 'countTokens', 'asyncBatchEmbedContent'],
    },
    {
      name: 'models/imagen-4.0-generate-001',
      version: '001',
      displayName: 'Imagen 4',
      description: 'Vertex served Imagen 4.0 model',
      inputTokenLimit: 480,
      outputTokenLimit: 8192,
      supportedGenerationMethods: ['predict'],
    },
  ],
  nextPageToken: 'Chdtb2RlbHMvZ2VtbWEtMy0yN2ItaXQ=',
};

export const geminiModelsAfter = {
  models: [
    {
      name: 'models/gemma-3-27b-it',
      version: '001',
      displayName: 'Gemma 3 27B',
      inputTokenLimit: 131_072,
      outputTokenLimit: 8192,
      supportedGenerationMethods: ['generateContent', 'countTokens'],
      temperature: 1,
      topP: 0.95,
      topK: 64,
    },
  ],
};

export const vercelGatewayModels = {
  object: 'list',
  data: [
    {
      id: 'anthropic/claude-haiku-4-5',
      object: 'model',
      created: 1_760_486_400,
      released: 1_760_486_400,
      owned_by: 'anthropic',
      name: 'Claude Haiku 4.5',
      description: 'Claude Haiku 4.5 matches Sonnet 4 performance on coding at a third of the cost.',
      context_window: 200_000,
      max_tokens: 64_000,
      type: 'language',
      tags: ['reasoning', 'tool-use', 'vision'],
      pricing: { input: '0.000001', output: '0.000005' },
      regions: ['us-east-1', 'eu-central-1'],
    },
    {
      id: 'alibaba/qwen-3-14b',
      object: 'model',
      created: 1_755_815_280,
      released: 1_745_798_400,
      owned_by: 'alibaba',
      name: 'Qwen3-14B',
      description: '',
      context_window: 40_960,
      max_tokens: 16_384,
      type: 'language',
      zdr: 'all',
      no_training: 'all',
      pricing: { input: '0.00000012', output: '0.00000024' },
    },
    {
      id: 'openai/text-embedding-3-small',
      object: 'model',
      created: 1_755_815_280,
      owned_by: 'openai',
      name: 'text-embedding-3-small',
      type: 'embedding',
      pricing: { input: '0.00000002' },
    },
    {
      id: 'google/imagen-4.0-generate-001',
      object: 'model',
      created: 1_755_815_280,
      owned_by: 'google',
      name: 'Imagen 4',
      type: 'image',
    },
  ],
};

export const liteLlmModels = {
  data: [
    { id: 'llama-3.3-70b', object: 'model', created: 1_677_610_602, owned_by: 'openai' },
    { id: 'acme-internal/claims-triage', object: 'model', created: 1_677_610_602, owned_by: 'acme-corp' },
  ],
  object: 'list',
};
