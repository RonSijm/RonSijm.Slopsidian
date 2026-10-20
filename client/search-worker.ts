import { searchDocuments, SearchQueryError, type SearchRequest, type SearchResponse } from "./search";

globalThis.onmessage = (event: MessageEvent<SearchRequest>): void => {
  const { id, documents, query, options } = event.data;
  let response: SearchResponse;
  try {
    response = { id, results: searchDocuments(documents, query, options) };
  } catch (error) {
    if (!(error instanceof SearchQueryError)) {
      throw error;
    }
    response = { id, error: error.message };
  }
  globalThis.postMessage(response);
};
globalThis.postMessage({ ready: true } satisfies SearchResponse);
