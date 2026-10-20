export const MAX_REGEX_SOURCE = 256;
export const REGEX_SUBSET_MESSAGE = "Fixed-width regex supports literals, character classes, dots, captures and anchors. Quantifiers, alternatives, lookarounds and backreferences are unavailable.";

/** Reject branching/repetition before JavaScript can execute a user-supplied regular expression. */
export function regexSearchValidation(pattern: string): string | null {
  if (pattern.length > MAX_REGEX_SOURCE) { return `Fixed-width regular expressions support up to ${MAX_REGEX_SOURCE} characters.`; }
  let inClass = false;
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === "\\") {
      const escape = pattern[++index];
      if (!escape) { return "Invalid regular expression."; }
      if (escape === "x" || escape === "u") {
        const length = escape === "x" ? 2 : 4, digits = pattern.slice(index + 1, index + 1 + length);
        if (digits.length !== length || !/^[\da-f]+$/i.test(digits)) { return REGEX_SUBSET_MESSAGE; }
        index += length;
      } else if (!/^[dDsSwWbBtnrfv\\.^$*+?()[\]{}|/-]$/.test(escape)) { return REGEX_SUBSET_MESSAGE; }
    } else if (character === "[" && !inClass) { inClass = true; }
    else if (character === "]" && inClass) { inClass = false; }
    else if (!inClass && ("*+?{}|".includes(character) || character === "(" && pattern[index + 1] === "?")) { return REGEX_SUBSET_MESSAGE; }
  }
  try { new RegExp(pattern, "mu"); } catch { return "Invalid regular expression."; }
  return null;
}

