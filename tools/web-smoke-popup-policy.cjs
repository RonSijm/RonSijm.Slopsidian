const POPOUT_NAME = /^slopsidian-popout-[A-Za-z0-9_-]{1,80}$/;
const SAFE_PREFERENCES = { nodeIntegration: false, contextIsolation: true, sandbox: true };

/** Test-host window-open policy: only the app's own same-origin named about:blank popouts are allowed, and only when opted in; everything else stays denied. */
function createPopupPolicy(origin, allowAppPopouts) {
  const sameOrigin = value => typeof value === "string" && URL.canParse(value) && new URL(value).origin === origin;
  return {
    windowOpenHandler(details) {
      const app = allowAppPopouts === true && details?.url === "about:blank" && POPOUT_NAME.test(details.frameName ?? "")
        && sameOrigin(details.referrer?.url) && details.disposition !== "background-tab";
      return app ? { action: "allow", overrideBrowserWindowOptions: { webPreferences: { ...SAFE_PREFERENCES } } } : { action: "deny" };
    },
    /** Popups may not open further windows or navigate away from about:blank. */
    guardPopup(contents) {
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
      contents.on("will-navigate", (event, target) => { if (target !== "about:blank") { event.preventDefault(); } });
    },
  };
}

module.exports = { createPopupPolicy, POPOUT_NAME };
