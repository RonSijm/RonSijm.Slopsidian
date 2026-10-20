"use strict";
// Entry point of the packaged desktop app. It resolves where mutable data lives (outside the install directory)
// and then loads the packaging-transformed copy of desktop\main.cjs.
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const executableDirectory = path.dirname(process.execPath);
const portable = fs.existsSync(path.join(executableDirectory, "portable.txt"));
const dataDirectory = process.env.SLOPSIDIAN_DATA_DIR
  ? path.resolve(process.env.SLOPSIDIAN_DATA_DIR)
  : portable ? path.join(executableDirectory, "Data") : path.join(app.getPath("appData"), "Slopsidian");

process.env.SLOPSIDIAN_DATA_DIR = dataDirectory;
console.log("PACKAGED_HOST " + JSON.stringify({ portable, dataDirectory }));
require("./desktop/main.cjs");
