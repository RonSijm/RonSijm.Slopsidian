// Model tests supply a small fake DOM, with no browser storage or Electron main
// process. Persistence and the real DOM notification are covered separately.
export const errorLogStub = {
  name: "model-error-sink",
  setup(build) {
    build.onResolve({ filter: /^\.\/error-log$/ }, () => ({ path: "error-log", namespace: "model-error-sink" }));
    build.onLoad({ filter: /.*/, namespace: "model-error-sink" }, () => ({ contents: `
      export function recordError(error){ return {error:{message:error instanceof Error?error.message:String(error)}}; }
      export async function downloadErrorLog(){}
    ` }));
  },
};
