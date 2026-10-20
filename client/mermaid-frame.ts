import mermaid from "mermaid";
import { MAX_MERMAID_CHARS, MAX_MERMAID_SVG_CHARS, prepareMermaid } from "./mermaid-policy";

// Runs in an opaque-origin, script-only sandbox with no network or Node access.
function connect(event: MessageEvent): void {
  if (event.source !== window.parent || event.data?.type !== "slopsidian-mermaid-connect" || event.ports.length !== 1) { return; }
  window.removeEventListener("message", connect);
  const port = event.ports[0];
  let busy = false;
  port.onmessage = async message => {
    const data = message.data;
    if (!data || data.type !== "render" || typeof data.id !== "string" || !/^mermaid-[a-f0-9]{32}$/.test(data.id) || typeof data.source !== "string" || data.source.length > MAX_MERMAID_CHARS || busy) { return; }
    busy = true;
    const stage = document.createElement("div"); document.body.append(stage);
    try {
      if (typeof Reflect.get(globalThis, "require") === "function" || Reflect.get(globalThis, "process")?.versions?.node) { throw new Error("The diagram renderer requires a sandbox without Node access."); }
      const definition = prepareMermaid(data.source);
      mermaid.initialize({
        startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true,
        maxTextSize: MAX_MERMAID_CHARS, maxEdges: 256, htmlLabels: false,
        theme: data.theme === "dark" ? "dark" : "default", look: "classic", layout: "dagre",
        ...definition.options,
        fontFamily: "Arial, sans-serif", flowchart: { htmlLabels: false },
        secure: ["secure", "securityLevel", "startOnLoad", "suppressErrorRendering", "maxTextSize", "maxEdges", "htmlLabels", "fontFamily", "dompurifyConfig"],
      });
      const text = definition.title === undefined ? definition.text : "---\ntitle: " + JSON.stringify(definition.title) + "\n---\n" + definition.text;
      const { svg, diagramType } = await mermaid.render(data.id, text, stage);
      if (svg.length > MAX_MERMAID_SVG_CHARS) { throw new Error("The rendered diagram exceeds the 4 MiB SVG limit."); }
      port.postMessage({ type: "result", id: data.id, svg, diagramType });
    } catch (error) {
      port.postMessage({ type: "result", id: data.id, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) });
    } finally { stage.remove(); busy = false; }
  };
  port.start(); port.postMessage({ type: "ready" });
}
window.addEventListener("message", connect);
