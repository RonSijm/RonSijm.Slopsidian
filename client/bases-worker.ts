import { queryBase, type BaseRequest, type BaseResponse } from "./bases-model";

self.addEventListener("message", (event: MessageEvent<BaseRequest>) => {
  const request = event.data;
  let response: BaseResponse;
  try { response = { serial: request.serial, result: queryBase(request) }; }
  catch (error) { response = { serial: request.serial, error: error instanceof Error ? error.message : String(error) }; }
  self.postMessage(response);
});
