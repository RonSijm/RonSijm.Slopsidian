import { queryBase, type BaseRequest, type BaseResponse } from "./bases-model";
import { baseExportTable, serializeBaseExport } from "./bases-export";

self.addEventListener("message", (event: MessageEvent<BaseRequest>) => {
  const request = event.data;
  let response: BaseResponse;
  try {
    const result = queryBase(request);
    if (request.export) {
      const table = baseExportTable(result);
      // Bound both selectable output formats before transferring the complete data to the UI.
      serializeBaseExport(table, "csv"); serializeBaseExport(table, "tsv");
    }
    response = { serial: request.serial, result };
  }
  catch (error) { response = { serial: request.serial, error: error instanceof Error ? error.message : String(error) }; }
  self.postMessage(response);
});
