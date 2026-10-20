const { appendFileSync, mkdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

function createErrorLog(profile, name = new Date().toISOString().slice(0, 10)) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(name)) { throw new Error("Invalid error log name."); }
  const directory = join(profile, "logs"), path = join(directory, "errors-" + name + ".jsonl");
  mkdirSync(directory, { recursive: true });
  appendFileSync(path, "", "utf8");
  return {
    path,
    append(record) {
      if (record?.schemaVersion !== 1 || typeof record.id !== "string" || typeof record.error?.message !== "string" || typeof record.error?.stack !== "string") { throw new Error("Invalid error log record."); }
      const line = JSON.stringify(record);
      if (Buffer.byteLength(line) > 2 * 1024 * 1024) { throw new Error("Error log record is too large."); }
      // Synchronous append completes before acknowledging the notification, including at shutdown.
      appendFileSync(path, line + "\n", "utf8");
      return path;
    },
    read() { return readFileSync(path, "utf8"); },
  };
}
module.exports = { createErrorLog };
