import { copyViewData } from "./contracts";

export const propertySorts = { name: "Name A-Z", nameReverse: "Name Z-A", frequency: "Most frequent", frequencyReverse: "Least frequent" } as const;
export interface PropertiesPaneState {
  query: string;
  sort: keyof typeof propertySorts;
  file: string | null;
  followActiveFile: boolean;
  expandedProperties: string[];
}

export function propertiesPaneState(value: unknown): PropertiesPaneState {
  const state = copyViewData(value);
  const query = state.query === undefined ? "" : state.query, sort = state.sort === undefined ? "name" : state.sort, file = state.file === undefined ? null : state.file;
  if (typeof query !== "string" || query.length > 1024 || typeof sort !== "string" || !Object.hasOwn(propertySorts, sort)) {
    throw new Error("Properties filters and sorting must use supported text values.");
  }
  if (file !== null && (typeof file !== "string" || !file || file.length > 4096 || /[\\\x00-\x1f]/.test(file) || file.split("/").some(part => !part || part.startsWith(".")))) {
    throw new Error("Properties needs a visible relative vault file path.");
  }
  const followActiveFile = state.followActiveFile === undefined ? file === null : state.followActiveFile;
  if (typeof followActiveFile !== "boolean") { throw new Error("Properties note following must be Boolean."); }
  const expandedProperties = state.expandedProperties === undefined ? [] : state.expandedProperties;
  if (!Array.isArray(expandedProperties) || expandedProperties.length > 1024 || expandedProperties.some(name => typeof name !== "string" || !name || name.length > 256)) {
    throw new Error("Expanded properties must contain at most 1,024 property names.");
  }
  return { query, sort: sort as PropertiesPaneState["sort"], file, followActiveFile, expandedProperties: [...new Set(expandedProperties.map(name => name.toLowerCase()))] };
}

export function sortedProperties<T extends { name: string; occurrences: number }>(entries: readonly T[], query: string, sort: PropertiesPaneState["sort"]): T[] {
  const needle = query.toLowerCase();
  return entries.filter(entry => entry.name.toLowerCase().includes(needle)).sort((left, right) => {
    const names = left.name.localeCompare(right.name);
    if (sort === "frequency" || sort === "frequencyReverse") { return (sort === "frequency" ? right.occurrences - left.occurrences : left.occurrences - right.occurrences) || names; }
    return sort === "nameReverse" ? -names : names;
  });
}
