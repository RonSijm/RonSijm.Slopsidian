import type { SearchRequest, SearchResponse, SearchResult } from "./search";

/** One owned worker/query. Cancellation invalidates every retained callback. */
export class SearchTask {
  private serial = 0;
  private worker: Worker | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly createWorker = (): Worker => new Worker(new URL("js/search-worker.js", document.baseURI), { type: "module" })) {}

  cancel(): void {
    this.serial++;
    if (this.worker) { this.worker.onmessage = null; this.worker.onerror = null; this.worker.terminate(); this.worker = null; }
    if (this.timeout !== null) { clearTimeout(this.timeout); this.timeout = null; }
  }

  run(request: Omit<SearchRequest, "id">, current: () => boolean, complete: (results: SearchResult[]) => void, failed: (message: string) => void): void {
    this.cancel(); const id = this.serial;
    const owned = (): boolean => id === this.serial && current();
    const failure = (message: string): void => { if (owned()) { this.cancel(); failed(message); } else if (id === this.serial) { this.cancel(); } };
    let worker: Worker;
    try { worker = this.createWorker(); }
    catch (error) { failure("Search engine could not start: " + (error instanceof Error ? error.message : String(error))); return; }
    this.worker = worker;
    let ready = false;
    this.timeout = setTimeout(() => failure("Search engine did not become ready within ten seconds. Retry the query."), 10000);
    worker.onerror = event => { event.preventDefault(); failure("Search engine failed: " + event.message); };
    worker.onmessage = (event: MessageEvent<SearchResponse>) => {
      if (!owned()) { if (id === this.serial) { this.cancel(); } return; }
      const response = event.data;
      if (!response || typeof response !== "object") { failure("The search engine returned an invalid response."); return; }
      if ("ready" in response) {
        if (ready) { return; } ready = true;
        if (this.timeout !== null) { clearTimeout(this.timeout); }
        this.timeout = setTimeout(() => failure("Search exceeded the two-second limit. Simplify the query."), 2000);
        try { worker.postMessage({ ...request, id }); }
        catch (error) { failure("Search engine could not accept the query: " + (error instanceof Error ? error.message : String(error))); }
        return;
      }
      if (!ready || response.id !== id) { return; }
      if (response.error !== undefined) { failure(response.error); return; }
      if (!Array.isArray(response.results)) { failure("The search engine returned no results collection."); return; }
      this.cancel(); complete(response.results);
    };
  }
}
