// The legacy build includes polyfills missing from Electron 39's Chromium.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

// Lazy-loaded as js/pdf-api.js so the PDF engine stays out of the main bundles.
export default pdfjs;
