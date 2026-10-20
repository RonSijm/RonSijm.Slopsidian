import { buildGraph, layoutGraph, type GraphRequest, type GraphResponse } from "./graph-model";

self.onmessage = (event: MessageEvent<GraphRequest>): void => {
  const request = event.data;
  let response: GraphResponse;
  try {
    const data = buildGraph(request.files, request.documents, request.options, request.center);
    layoutGraph(data, request.options);
    response = { id: request.id, data };
  } catch (error) {
    response = { id: request.id, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};
