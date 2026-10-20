"use strict";
const { createHash, randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CHANNEL = "slopsidian:spellcheck";
const MAX_AGE = 30_000;
const MANAGEMENT_AGE = 120_000;
const MAX_LANGUAGES = 8;
const MAX_WORDS = 10_000;
const MAX_WORD_CHARACTERS = 1_048_576;

function validWord(word) { return typeof word === "string" && word.length > 0 && word.length <= 256 && !/[\s\x00-\x1f\x7f]/u.test(word); }
function supportedLanguages(session) {
  const values = session.availableSpellCheckerLanguages;
  if (!Array.isArray(values) || values.length > 256 || values.some(value => typeof value !== "string" || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value) || value.length > 48)) {
    throw new Error("The host's spelling language list is unavailable.");
  }
  return [...new Set(values)].sort();
}
function validateLanguages(values, supported) {
  if (!Array.isArray(values) || !values.length || values.length > MAX_LANGUAGES || new Set(values).size !== values.length
    || values.some(value => typeof value !== "string" || !supported.includes(value))) {
    throw new Error("Choose one to eight different supported spelling languages.");
  }
  return [...values];
}
function readLanguageStore(file) {
  if (!file) { return { bytes: null, data: null }; }
  if (!path.isAbsolute(file)) { throw new Error("Spelling preferences require an owned absolute profile path."); }
  let info;
  try { info = fs.lstatSync(file); } catch (error) { if (error.code === "ENOENT") return { bytes: null, data: null }; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16_384) { throw new Error("The spelling preferences file is not a small regular file."); }
  const bytes = fs.readFileSync(file);
  if (bytes.length > 16_384) { throw new Error("The spelling preferences file is too large."); }
  const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!data || typeof data !== "object" || Array.isArray(data) || data.schemaVersion !== 1 || !Array.isArray(data.languages)) {
    throw new Error("The spelling preferences file has an unsupported format. Reload after repairing it.");
  }
  return { bytes, data };
}
const fileVersion = store => store.bytes === null ? "missing" : createHash("sha256").update(store.bytes).digest("hex");
function writeLanguages(file, previous, languages) {
  if (!file) { throw new Error("Persistent spelling preferences are unavailable in this app profile."); }
  const bytes = Buffer.from(JSON.stringify({ ...previous.data, schemaVersion: 1, languages }, null, 2) + "\n");
  if (bytes.length > 16_384) { throw new Error("The spelling preferences file would exceed its size limit."); }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + "." + randomBytes(16).toString("hex") + ".tmp";
  try {
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    if (fileVersion(readLanguageStore(file)) !== fileVersion(previous)) { throw new Error("Spelling preferences changed outside this page. Reload first."); }
    if (previous.bytes === null) { fs.linkSync(temporary, file); }
    else { fs.renameSync(temporary, file); }
  } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}
async function dictionaryWords(session) {
  let timeout;
  try {
    const words = await Promise.race([session.listWordsInSpellCheckerDictionary(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("The host spelling dictionary did not finish loading. Reload to try again.")), 3_000); })]);
    if (!Array.isArray(words) || words.length > MAX_WORDS) { throw new Error("The custom dictionary exceeds the 10,000-word management limit."); }
    let characters = 0;
    for (const word of words) { if (!validWord(word) || (characters += word.length) > MAX_WORD_CHARACTERS) { throw new Error("The custom dictionary contains unsupported or excessive word data."); } }
    return [...new Set(words)].sort();
  } finally { clearTimeout(timeout); }
}
const managementVersion = (languages, words, store) => createHash("sha256").update(JSON.stringify([languages, words, fileVersion(store)])).digest("hex");

function initializeSpellcheckLanguages(session, locale = "en-US") {
  const existing = session.getSpellCheckerLanguages();
  if (existing.length) { return { initialized: false, error: null }; }
  const supported = session.availableSpellCheckerLanguages;
  const normalized = typeof locale === "string" ? locale.replaceAll("_", "-").toLowerCase() : "";
  const language = supported.find(value => value.toLowerCase() === normalized)
    ?? supported.find(value => value.toLowerCase().split("-")[0] === normalized.split("-")[0])
    ?? supported.find(value => value.toLowerCase() === "en-us");
  if (!language) { return { initialized: false, error: "No supported spelling dictionary language is available." }; }
  try {
    // Chromium owns dictionary provisioning. Do not replace existing language
    // choices, fetch dictionary files ourselves, or install a custom provider.
    session.setSpellCheckerLanguages([language]);
    return { initialized: true, error: null };
  } catch (error) { return { initialized: false, error: error instanceof Error ? error.message : String(error) }; }
}

/** Native dictionary information only; note replacements stay in guarded CodeMirror transactions. */
function installSpellcheck({ owner, ipcMain, localUrl, popouts, languagesPath, isClosing = () => false, now = Date.now, locale = "en-US", platform = process.platform }) {
  const records = new Map(), installed = new Set();
  const management = new Map(), managementEpochs = new Map();
  let tail = Promise.resolve();
  const enqueue = operation => { const result = tail.then(operation, operation); tail = result.catch(() => {}); return result; };
  let initialization;
  try {
    const store = readLanguageStore(languagesPath);
    if (store.data) {
      owner.webContents.session.setSpellCheckerLanguages(validateLanguages(store.data.languages, supportedLanguages(owner.webContents.session)));
      initialization = { initialized: true, error: null };
    } else { initialization = initializeSpellcheckLanguages(owner.webContents.session, locale); }
  } catch (error) { initialization = { initialized: false, error: "Saved spelling languages could not be loaded: " + (error instanceof Error ? error.message : String(error)) }; }
  const owned = contents => !owner.isDestroyed() && !owner.webContents.isDestroyed() && (contents === owner.webContents
    || Boolean(popouts?.names().some(name => popouts.get(name)?.webContents === contents)));
  const allowed = event => !isClosing() && owned(event.sender) && !event.sender.isDestroyed()
    && event.senderFrame === event.sender.mainFrame
    && (event.sender === owner.webContents ? localUrl(event.senderFrame.url) : event.senderFrame.url === "about:blank");
  const revoke = contents => { management.delete(contents); managementEpochs.set(contents, (managementEpochs.get(contents) ?? 0) + 1); };
  const capabilities = session => ({ languages: platform === "win32" && Boolean(languagesPath), dictionary: platform === "win32" && typeof session.isPersistent === "function" && session.isPersistent()
    && typeof session.listWordsInSpellCheckerDictionary === "function" && typeof session.addWordToSpellCheckerDictionary === "function" && typeof session.removeWordFromSpellCheckerDictionary === "function" });
  const managementSnapshot = async (event, epoch) => {
    const session = event.sender.session, supported = supportedLanguages(session), capability = capabilities(session);
    const words = capability.dictionary ? await dictionaryWords(session) : [], store = readLanguageStore(languagesPath), languages = session.getSpellCheckerLanguages();
    if (!Array.isArray(languages) || languages.length > MAX_LANGUAGES || languages.some(value => typeof value !== "string" || !supported.includes(value))) { throw new Error("The current host spelling languages are unsupported. Repair them before managing this profile."); }
    if (!allowed(event) || managementEpochs.get(event.sender) !== epoch) { throw new Error("These spelling controls are no longer current."); }
    const token = randomBytes(16).toString("hex"), version = managementVersion(languages, words, store);
    management.set(event.sender, { token, version, epoch, at: now() });
    return { token, supported, languages, words, canSetLanguages: capability.languages, canManageWords: capability.dictionary, osSharedDictionary: platform === "win32", maxLanguages: MAX_LANGUAGES, maxWords: MAX_WORDS };
  };
  const watch = contents => {
    if (installed.has(contents)) { return; }
    installed.add(contents);
    contents.on("context-menu", (_event, params) => {
      records.delete(contents);
      if (!owned(contents) || isClosing() || params.isEditable !== true || typeof params.misspelledWord !== "string"
        || params.misspelledWord.length > 256 || /[\s\x00-\x1f\x7f]/u.test(params.misspelledWord)
        || !Number.isFinite(params.x) || !Number.isFinite(params.y)) { return; }
      const suggestions = [...new Set((Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions : [])
        .filter(value => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\r\n\x00]/.test(value)))].slice(0, 6);
      records.set(contents, { token: randomBytes(16).toString("hex"), word: params.misspelledWord, suggestions, x: params.x, y: params.y, at: now() });
    });
    contents.on("did-start-navigation", details => { if (details.isMainFrame && !details.isSameDocument) { records.delete(contents); revoke(contents); } });
    contents.on("render-process-gone", () => { records.delete(contents); revoke(contents); });
    contents.on("destroyed", () => { records.delete(contents); revoke(contents); managementEpochs.delete(contents); installed.delete(contents); });
  };
  watch(owner.webContents);
  owner.webContents.on("did-create-window", (child, details) => { if (popouts?.get(details.frameName) === child) { watch(child.webContents); } });
  ipcMain.handle(CHANNEL, async (event, operation, request) => {
    if (!allowed(event)) { throw new Error("Spelling information belongs to the owning local editor window."); }
    if (!request || typeof request !== "object" || Array.isArray(request)) { throw new Error("Invalid spelling request."); }
    if (operation === "state") {
      return { languages: event.sender.session.getSpellCheckerLanguages(), enabled: event.sender.session.spellCheckerEnabled !== false, ...initialization };
    }
    if (operation === "management/release") { revoke(event.sender); return true; }
    if (operation === "management/read") {
      revoke(event.sender); const epoch = managementEpochs.get(event.sender);
      return enqueue(() => managementSnapshot(event, epoch));
    }
    if (["management/languages", "management/add", "management/remove"].includes(operation)) {
      const captured = management.get(event.sender);
      if (!captured || typeof request.token !== "string" || request.token !== captured.token || now() - captured.at > MANAGEMENT_AGE) { throw new Error("These spelling controls expired or changed. Reload first."); }
      return enqueue(async () => {
        if (!allowed(event) || management.get(event.sender) !== captured || managementEpochs.get(event.sender) !== captured.epoch || now() - captured.at > MANAGEMENT_AGE) { throw new Error("These spelling controls are no longer current. Reload first."); }
        const session = event.sender.session, capability = capabilities(session), supported = supportedLanguages(session);
        const words = capability.dictionary ? await dictionaryWords(session) : [], store = readLanguageStore(languagesPath), languages = session.getSpellCheckerLanguages();
        if (!allowed(event) || management.get(event.sender) !== captured || managementEpochs.get(event.sender) !== captured.epoch || now() - captured.at > MANAGEMENT_AGE) { throw new Error("These spelling controls are no longer current. Reload first."); }
        if (managementVersion(languages, words, store) !== captured.version) { revoke(event.sender); throw new Error("The host spelling preferences or dictionary changed. Reload first."); }
        if (operation === "management/languages") {
          if (!capability.languages) { throw new Error("Spelling language management is unavailable on this host."); }
          const values = validateLanguages(request.languages, supported);
          session.setSpellCheckerLanguages(values);
          try { writeLanguages(languagesPath, store, values); }
          catch (error) { try { session.setSpellCheckerLanguages(languages); } catch { throw new Error("Spelling language saving failed and the previous host choice could not be restored. Reload the application."); } throw error; }
        } else {
          if (!capability.dictionary) { throw new Error("Custom dictionary management is unavailable on this host."); }
          if (!validWord(request.word)) { throw new Error("Use one word of up to 256 characters without spaces or control characters."); }
          const exists = words.includes(request.word);
          if (operation === "management/add" ? exists : !exists) { throw new Error(operation === "management/add" ? "That exact word is already in the custom dictionary." : "That word is no longer in the custom dictionary. Reload first."); }
          if (operation === "management/add" && (words.length >= MAX_WORDS || words.reduce((count, value) => count + value.length, 0) + request.word.length > MAX_WORD_CHARACTERS)) { throw new Error("The custom dictionary management limit has been reached."); }
          const changed = operation === "management/add" ? session.addWordToSpellCheckerDictionary(request.word) : session.removeWordFromSpellCheckerDictionary(request.word);
          if (changed !== true) { throw new Error("The host did not accept the custom dictionary change."); }
        }
        records.clear(); management.clear();
        return managementSnapshot(event, captured.epoch);
      });
    }
    if (operation === "context") {
      if (!Number.isFinite(request.x) || !Number.isFinite(request.y)) { throw new Error("Invalid spelling coordinates."); }
      // The trusted DOM context event and Chromium's native dictionary event can
      // arrive in either order. Only the same recent pointer position may match.
      const started = now();
      for (let attempts = 0; attempts < 30; attempts++) {
        if (!allowed(event)) { return null; }
        const record = records.get(event.sender);
        if (record && now() - record.at <= 500 && record.at >= started - 500 && Math.abs(record.x - request.x) <= 2 && Math.abs(record.y - request.y) <= 2) {
          return { token: record.token, word: record.word, suggestions: record.suggestions };
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return null;
    }
    if (operation === "add") {
      const record = records.get(event.sender);
      if (!record || !record.word || typeof request.token !== "string" || request.token !== record.token || now() - record.at > MAX_AGE) {
        throw new Error("The spelling context is no longer current.");
      }
      return enqueue(() => {
        if (!allowed(event) || records.get(event.sender) !== record || now() - record.at > MAX_AGE) { throw new Error("The spelling context is no longer current."); }
        if (event.sender.session.addWordToSpellCheckerDictionary(record.word) !== true) { throw new Error("The host did not accept the custom dictionary change."); }
        records.clear(); management.clear(); return true;
      });
    }
    throw new Error("Unknown spelling operation.");
  });
  return { clear: () => { records.clear(); for (const contents of installed) { revoke(contents); } }, whenIdle: () => tail };
}

module.exports = { installSpellcheck, initializeSpellcheckLanguages, SPELLCHECK_CHANNEL: CHANNEL };
