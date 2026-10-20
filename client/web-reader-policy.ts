export const READER_MAX_ELEMENTS = 20_000;
export const READER_MAX_SOURCE = 2_000_000;
export const READER_MAX_CONTENT = 1_000_000;
export const READER_MIN_TEXT = 200;

export interface ReaderArticle {
  url: string;
  title: string;
  byline: string;
  content: string;
  textLength: number;
  lang: string;
  dir: "ltr" | "rtl";
}

export function readerLink(value: string, base: string): string | null {
  if (typeof value !== "string" || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) { return null; }
  try {
    const url = new URL(value, base);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.href.length <= 8192 ? url.href : null;
  } catch { return null; }
}

export function readerArticle(value: unknown, expectedUrl: string): ReaderArticle {
  if (!value || typeof value !== "object") { throw new Error("The page did not return a readable article."); }
  const article = value as Record<string, unknown>;
  if (article.url !== expectedUrl || readerLink(expectedUrl, expectedUrl) !== expectedUrl
    || typeof article.title !== "string" || article.title.length > 1024 || typeof article.byline !== "string" || article.byline.length > 1024
    || typeof article.content !== "string" || !article.content || article.content.length > READER_MAX_CONTENT
    || typeof article.textLength !== "number" || !Number.isSafeInteger(article.textLength) || article.textLength < READER_MIN_TEXT || article.textLength > READER_MAX_SOURCE
    || typeof article.lang !== "string" || !/^[a-z0-9-]{0,35}$/i.test(article.lang) || !["ltr", "rtl"].includes(String(article.dir))) {
    throw new Error("The page returned an invalid or oversized article.");
  }
  return article as unknown as ReaderArticle;
}

export function escapeReaderText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
