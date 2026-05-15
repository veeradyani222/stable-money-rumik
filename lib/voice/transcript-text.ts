const LEAKED_PROMPT_EXAMPLE_PREFIX =
  /^kya aap mujhe mere kyc status ke baare mein bata sakte hain\?\s*/i;

export function normalizeOpenAITranscript(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(LEAKED_PROMPT_EXAMPLE_PREFIX, '').trim();
}
