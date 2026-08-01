export const DEFAULT_MAX_MESSAGE_RUNES = 3_900;

export function chunkText(text: string, maxRunes = DEFAULT_MAX_MESSAGE_RUNES): string[] {
  const runes = Array.from(text);
  const limit = maxRunes > 0 ? maxRunes : DEFAULT_MAX_MESSAGE_RUNES;
  const chunks: string[] = [];
  for (let offset = 0; offset < runes.length; offset += limit) {
    chunks.push(runes.slice(offset, offset + limit).join(''));
  }
  return chunks;
}

export function markdownV2(text: string): string {
  return Array.from(text, escapeMarkdownRune).join('');
}

function escapeMarkdownRune(char: string): string {
  return '_*[]()~`>#+-=|{}.!\\'.includes(char) ? `\\${char}` : char;
}

export function isTelegramParseError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return message.includes("can't parse entities") || message.includes("can't find end of") ||
    message.includes('parse entities');
}
