const notForConversation: readonly RegExp[] = [
  /^ft:/u,
  /embedding/u,
  /^(?:whisper|tts)-|-tts(?:-|$)|transcribe/u,
  /audio/u,
  /^(?:dall-e|gpt-image|chatgpt-image)|-image(?:-|$)/u,
  /^sora/u,
  /^veo-/u,
  /^grok-imagine/u,
  /nano-banana/u,
  /moderation/u,
  /realtime/u,
  /^(?:babbage|davinci)-/u,
];

const modesForConversation: ReadonlySet<unknown> = new Set<unknown>(['chat', 'responses', 'completion']);

export function isForConversation(id: string): boolean {
  const model = id.slice(id.lastIndexOf('/') + 1);
  return !notForConversation.some((pattern: Readonly<RegExp>) => pattern.test(model));
}

export function isModeForConversation(mode: unknown): boolean {
  return mode === undefined || modesForConversation.has(mode);
}
