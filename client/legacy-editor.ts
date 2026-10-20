import CodeMirror from "codemirror";
import "codemirror/lib/codemirror.css";
import "codemirror/mode/meta";
import "codemirror/mode/javascript/javascript";
import "codemirror/mode/css/css";
import "codemirror/mode/xml/xml";
import "codemirror/mode/htmlmixed/htmlmixed";
import "codemirror/mode/yaml/yaml";
import "codemirror/mode/stex/stex";
import "codemirror/mode/gfm/gfm";
import "codemirror/addon/runmode/runmode";
import "../vendor/hypermd-mode/hypermd.js";
import { installClassicStreamLanguages } from "./legacy-language";

if ("CodeMirror" in window && window.CodeMirror !== CodeMirror) {
  throw new Error("A different legacy CodeMirror runtime is already installed.");
}
Object.assign(window, { CodeMirror });
installClassicStreamLanguages(CodeMirror);

export { CodeMirror };
