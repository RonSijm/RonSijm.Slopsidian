// Core settings writes require the last-read settingsVersion. Existing validation tests read it from /api/core
// and send it; tests that exercise the version contract itself send `version` explicitly instead.
export async function requestWithVersion(host, path, method, body) {
  const match = method === "PUT" ? /^\/api\/core\/([^/]+)\/settings$/.exec(path) : null;
  if (!match || !body || body.version !== undefined) { return host.request(path, method, body); }
  const snapshot = await host.request("/api/core");
  const value = typeof snapshot.json === "function" ? await snapshot.json() : snapshot.value;
  const state = value?.plugins?.find(plugin => plugin.id === match[1]);
  return host.request(path, method, { ...body, version: state?.settingsVersion ?? null });
}
