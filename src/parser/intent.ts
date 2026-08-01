const SUMMARY_INTENT_PATTERNS = [
  /\bchi\s*tieu\s*thang\s*nay\b/u,
  /\btong\s*chi\s*thang\s*nay\b/u,
  /\bxem\s*chi\s*thang\s*nay\b/u,
  /\bthong\s*ke\s*thang\s*nay\b/u,
  /\bbao\s*cao\s*thang\s*nay\b/u,
  /\bbao\s*cao\s*chi\s*tieu\b/u,
  /\bchi\s*tieu\s+thang\s+(?:0?[1-9]|1[0-2])(?:\b|\/)/u,
  /\btong\s*chi\s+thang\s+(?:0?[1-9]|1[0-2])(?:\b|\/)/u,
  /\bxem\s*chi\s+thang\s+(?:0?[1-9]|1[0-2])(?:\b|\/)/u,
  /\bthong\s*ke\s+thang\s+(?:0?[1-9]|1[0-2])(?:\b|\/)/u,
  /\bbao\s*cao\s+thang\s+(?:0?[1-9]|1[0-2])(?:\b|\/)/u,
  /^\/summary(?:\s|$)/u,
];

export function detectMonthlySummaryIntent(input: string): boolean {
  const normalized = normalizeForIntent(input);
  return normalized !== '' && SUMMARY_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function normalizeForIntent(input: string): string {
  let normalized = '';
  let pendingSpace = false;
  for (const original of input.trim().toLowerCase()) {
    const char = foldVietnameseChar(original);
    if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char === '/') {
      if (pendingSpace && normalized) normalized += ' ';
      pendingSpace = false;
      normalized += char;
    } else {
      pendingSpace = true;
    }
  }
  return normalized.trim();
}

function foldVietnameseChar(char: string): string {
  const groups: Record<string, string> = {
    à: 'a',
    á: 'a',
    ạ: 'a',
    ả: 'a',
    ã: 'a',
    â: 'a',
    ầ: 'a',
    ấ: 'a',
    ậ: 'a',
    ẩ: 'a',
    ẫ: 'a',
    ă: 'a',
    ằ: 'a',
    ắ: 'a',
    ặ: 'a',
    ẳ: 'a',
    ẵ: 'a',
    è: 'e',
    é: 'e',
    ẹ: 'e',
    ẻ: 'e',
    ẽ: 'e',
    ê: 'e',
    ề: 'e',
    ế: 'e',
    ệ: 'e',
    ể: 'e',
    ễ: 'e',
    ì: 'i',
    í: 'i',
    ị: 'i',
    ỉ: 'i',
    ĩ: 'i',
    ò: 'o',
    ó: 'o',
    ọ: 'o',
    ỏ: 'o',
    õ: 'o',
    ô: 'o',
    ồ: 'o',
    ố: 'o',
    ộ: 'o',
    ổ: 'o',
    ỗ: 'o',
    ơ: 'o',
    ờ: 'o',
    ớ: 'o',
    ợ: 'o',
    ở: 'o',
    ỡ: 'o',
    ù: 'u',
    ú: 'u',
    ụ: 'u',
    ủ: 'u',
    ũ: 'u',
    ư: 'u',
    ừ: 'u',
    ứ: 'u',
    ự: 'u',
    ử: 'u',
    ữ: 'u',
    ỳ: 'y',
    ý: 'y',
    ỵ: 'y',
    ỷ: 'y',
    ỹ: 'y',
    đ: 'd',
  };
  return groups[char] ?? char;
}
