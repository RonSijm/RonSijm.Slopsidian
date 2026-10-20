function microphoneOwner(contents, window, endpoint, url, mainFrame) {
  if (!window || contents !== window.webContents || mainFrame !== true || !URL.canParse(url) || !URL.canParse(endpoint)) { return false; }
  const requested = new URL(url), expected = new URL(endpoint);
  return requested.protocol === "http:" && requested.origin === expected.origin;
}

function installMicrophonePermission(session, window, endpoint, dialog, synthetic = false) {
  let granted = synthetic;
  session.setPermissionCheckHandler((contents, permission, origin, details) => {
    if (permission !== "media") { return true; }
    return microphoneOwner(contents, window, endpoint, details.requestingUrl || details.securityOrigin || origin, details.isMainFrame)
      && details.mediaType !== "video" && granted;
  });
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permission !== "media") { callback(true); return; }
    if (!microphoneOwner(contents, window, endpoint, details.requestingUrl || details.securityOrigin, details.isMainFrame)
      || !Array.isArray(details.mediaTypes) || !details.mediaTypes.length || details.mediaTypes.some(type => type !== "audio")) { callback(false); return; }
    if (granted) { callback(true); return; }
    dialog.showMessageBox(window, {
      type: "question", title: "Microphone access", message: "Allow Slopsidian to record microphone audio?",
      detail: "Recording starts from Audio recorder. Stop it to release the microphone; save a recording only when you choose to.",
      buttons: ["Allow microphone", "Cancel"], defaultId: 1, cancelId: 1,
    }).then(result => { granted = result.response === 0; callback(granted); }).catch(() => callback(false));
  });
}

module.exports = { microphoneOwner, installMicrophonePermission };
