import DOMPurify from "dompurify";
import type mermaidApi from "mermaid";
import { MAX_MERMAID_SVG_CHARS, prepareMermaid } from "./mermaid-policy";

let loadedApi: Promise<typeof mermaidApi> | undefined;

export function loadMermaid(): Promise<typeof mermaidApi> {
  return loadedApi ??= import(new URL("js/mermaid-api.js", document.baseURI).href).then((module: { default: typeof mermaidApi }) => {
    Object.defineProperty(window, "mermaid", { configurable: true, writable: true, value: module.default });
    return module.default;
  });
}

interface Result { svg: string; diagramType: string }
interface Job { id: string; source: string; theme: string; cancelled: boolean; resolve(result: Result): void; reject(error: Error): void }
interface Session {
  frame: HTMLIFrameElement; port: MessagePort | null; ready: Promise<MessagePort>;
  rejectReady(error: Error): void; timer: ReturnType<typeof setTimeout>;
  pending: { id: string; resolve(result: Result): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null;
}
const aborted = (): Error => new DOMException("Diagram rendering was cancelled.", "AbortError");

/** One lazy sandbox serializes Mermaid's global configuration; no SVG enters the app DOM. */
class MermaidRenderer {
  private session: Session | null = null;
  private readonly queue: Job[] = [];
  private current: Job | null = null;
  private pumping = false;

  render(source: string): { promise: Promise<Result>; cancel(): void } {
    prepareMermaid(source);
    if (this.queue.length >= 64) { throw new Error("Too many diagrams are waiting to render. Close some diagram views and try again."); }
    let job!: Job;
    const promise = new Promise<Result>((resolve, reject) => {
      job = { id: "mermaid-" + crypto.randomUUID().replaceAll("-", ""), source, theme: document.body.classList.contains("theme-light") ? "default" : "dark", cancelled: false, resolve, reject };
    });
    this.queue.push(job); void this.pump();
    return { promise, cancel: () => {
      job.cancelled = true; job.reject(aborted());
      if (this.current === job) { this.destroy(aborted()); }
    } };
  }

  private async pump(): Promise<void> {
    if (this.pumping) { return; }
    this.pumping = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        if (job.cancelled) { continue; }
        this.current = job;
        try {
          const session = this.session ?? this.create();
          const port = await session.ready;
          if (job.cancelled || session !== this.session) { throw aborted(); }
          const result = await new Promise<Result>((resolve, reject) => {
            const timer = setTimeout(() => this.destroy(new Error("Diagram rendering timed out. Simplify the diagram and try again.")), 15_000);
            session.pending = { id: job.id, resolve, reject, timer };
            port.postMessage({ type: "render", id: job.id, source: job.source, theme: job.theme });
          });
          if (!job.cancelled) { job.resolve(result); }
        } catch (error) { job.reject(error instanceof Error ? error : new Error(String(error))); }
        finally { this.current = null; }
      }
    } finally { this.pumping = false; this.destroy(aborted()); }
  }

  private create(): Session {
    const frame = document.createElement("iframe");
    frame.className = "mermaid-render-sandbox"; frame.dataset.mermaidSandbox = "";
    frame.title = "Diagram renderer"; frame.tabIndex = -1; frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-scripts"); frame.referrerPolicy = "no-referrer";
    frame.src = new URL("mermaid-frame.html", document.baseURI).href;
    let resolveReady!: (port: MessagePort) => void, rejectReady!: (error: Error) => void;
    const ready = new Promise<MessagePort>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const session: Session = { frame, port: null, ready, rejectReady, pending: null, timer: setTimeout(() => this.destroy(new Error("The local Mermaid renderer could not load. Reload the application and try again.")), 15_000) };
    this.session = session;
    frame.onload = () => {
      if (this.session !== session) { return; }
      frame.onload = null;
      const channel = new MessageChannel(); session.port = channel.port1;
      channel.port1.onmessage = event => {
        if (this.session !== session) { return; }
        const data = event.data;
        if (data?.type === "ready") { clearTimeout(session.timer); resolveReady(channel.port1); return; }
        const pending = session.pending;
        if (!pending || data?.type !== "result" || data.id !== pending.id) { return; }
        clearTimeout(pending.timer); session.pending = null;
        if (typeof data.error === "string") { pending.reject(new Error(data.error.slice(0, 2000))); }
        else if (typeof data.svg === "string" && data.svg.length <= MAX_MERMAID_SVG_CHARS && typeof data.diagramType === "string") { pending.resolve({ svg: data.svg, diagramType: data.diagramType.slice(0, 100) }); }
        else { pending.reject(new Error("The diagram renderer returned invalid output.")); }
      };
      channel.port1.start(); frame.contentWindow?.postMessage({ type: "slopsidian-mermaid-connect" }, "*", [channel.port2]);
    };
    document.body.append(frame);
    return session;
  }

  private destroy(reason: Error): void {
    const session = this.session;
    if (!session) { return; }
    this.session = null; clearTimeout(session.timer); session.rejectReady(reason);
    if (session.pending) { clearTimeout(session.pending.timer); session.pending.reject(reason); }
    session.port?.close(); session.frame.onload = null; session.frame.remove();
  }
}

const renderer = new MermaidRenderer();

function imageData(svg: string): { data: string; label: string } {
  const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ["script", "foreignObject", "image", "a", "use", "animate", "animateMotion", "animateTransform", "set"] });
  const doc = new DOMParser().parseFromString(clean, "image/svg+xml"), root = doc.documentElement;
  if (root.localName !== "svg" || doc.querySelector("parsererror")) { throw new Error("The diagram renderer returned an invalid SVG image."); }
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[ ,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0 || viewBox[2] > 20_000 || viewBox[3] > 20_000 || viewBox[2] * viewBox[3] > 100_000_000) { throw new Error("The rendered diagram is too large or has invalid dimensions."); }
  root.setAttribute("width", String(Math.ceil(viewBox[2]))); root.setAttribute("height", String(Math.ceil(viewBox[3])));
  const description = [root.querySelector("title")?.textContent, root.querySelector("desc")?.textContent].filter(Boolean).join(". ");
  const labels = [...root.querySelectorAll("text")].map(node => [...node.childNodes].map(child => child.textContent).join(" ").replace(/\s+/g, " ").trim()).filter(Boolean).join(", ");
  const label = (description || "Mermaid diagram" + (labels ? ": " + labels : "")).slice(0, 2000);
  return { data: new XMLSerializer().serializeToString(root), label };
}

export function mountMermaid(container: HTMLElement, source: string): () => void {
  let disposed = false, url: string | null = null, job: ReturnType<MermaidRenderer["render"]> | null = null;
  container.classList.add("mermaid-diagram"); container.dataset.mermaidStatus = "pending";
  const status = document.createElement("p"); status.className = "mermaid-status"; status.setAttribute("role", "status"); status.textContent = "Rendering diagram…";
  const details = document.createElement("details"), summary = document.createElement("summary"), pre = document.createElement("pre"), code = document.createElement("code");
  summary.textContent = "Diagram source"; code.textContent = source; pre.append(code); details.append(summary, pre); container.append(status, details);
  const failure = (error: unknown): void => {
    if (disposed) { return; }
    container.dataset.mermaidStatus = "error"; status.classList.add("is-error"); status.textContent = "Could not render Mermaid diagram: " + (error instanceof Error ? error.message : String(error)); details.open = true;
  };
  try {
    job = renderer.render(source);
    job.promise.then(result => {
      if (disposed) { return; }
      try {
        const image = imageData(result.svg), img = document.createElement("img");
        url = URL.createObjectURL(new Blob([image.data], { type: "image/svg+xml" }));
        img.className = "mermaid-image"; img.alt = image.label; img.dataset.mermaidType = result.diagramType;
        img.onload = () => { if (!disposed) { container.dataset.mermaidStatus = "ready"; status.remove(); } };
        img.onerror = () => failure(new Error("This host could not decode the rendered SVG image."));
        img.src = url; container.insertBefore(img, details);
      } catch (error) { failure(error); }
    }, failure);
  } catch (error) { failure(error); }
  return () => { disposed = true; job?.cancel(); container.querySelectorAll("img").forEach(image => { image.onload = null; image.onerror = null; image.removeAttribute("src"); }); if (url) { URL.revokeObjectURL(url); url = null; } };
}
