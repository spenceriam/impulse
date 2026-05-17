function stripCodeBlocks(content: string): string {
  return content.replace(/```[\s\S]*?```/g, "");
}

export function shouldRetryInEnglish(content: string): boolean {
  const text = stripCodeBlocks(content);
  const cjkChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinChars = text.match(/[A-Za-z]/g)?.length ?? 0;
  const languageChars = cjkChars + latinChars;

  if (languageChars === 0) return false;
  return cjkChars >= 20 && cjkChars / languageChars > 0.35;
}
