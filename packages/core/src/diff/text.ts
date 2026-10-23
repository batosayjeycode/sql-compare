/**
 * Inline code span for descriptions (Markdown-safe): text containing
 * backticks is wrapped in a longer backtick fence, padded with spaces.
 */
export function code(text: string): string {
  const runs = text.match(/`+/g);
  if (!runs) return `\`${text}\``;
  const fence = '`'.repeat(Math.max(...runs.map((r) => r.length)) + 1);
  return `${fence} ${text} ${fence}`;
}
