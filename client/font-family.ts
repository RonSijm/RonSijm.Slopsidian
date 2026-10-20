// Reader also serializes this standalone validator into its opaque frame.
export function localFontName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 100) { throw new RangeError(`Choose a ${label} of 1\u2013100 characters, using a single local family name.`); }
  const name = value.replace(/^ +| +$/g, "");
  if (!/\p{L}/u.test(name) || !/^[\p{L}\p{M}\p{N} ._'()-]+$/u.test(name)) {
    throw new RangeError(`Choose a ${label} using letters, numbers, spaces, periods, underscores, apostrophes, parentheses or hyphens.`);
  }
  return name;
}
