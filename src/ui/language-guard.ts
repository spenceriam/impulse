const HAN_CHAR_REGEX = /[\u3400-\u9fff]/g;
const LATIN_CHAR_REGEX = /[A-Za-z]/g;
const FENCED_CODE_BLOCK_REGEX = /```[\s\S]*?```/g;
const INLINE_CODE_REGEX = /`[^`]+`/g;

export const ENGLISH_RETRY_PROMPT =
  "Your previous response was not in English. Please answer again in English only. Keep the same intent and structure, and do not use Chinese.";

export function shouldRetryInEnglish(content: string): boolean {
  if (!content || !content.trim()) return false;

  // Ignore code-heavy content so snippets/comments don't cause false positives.
  const normalized = content
    .replace(FENCED_CODE_BLOCK_REGEX, " ")
    .replace(INLINE_CODE_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return false;

  const hanCount = normalized.match(HAN_CHAR_REGEX)?.length ?? 0;
  if (hanCount < 8) return false;

  const latinCount = normalized.match(LATIN_CHAR_REGEX)?.length ?? 0;
  const letterCount = hanCount + latinCount;

  if (latinCount === 0) return true;
  if (letterCount < 24) {
    return hanCount > latinCount * 1.2;
  }

  const hanRatio = hanCount / letterCount;
  return hanRatio >= 0.35;
}
