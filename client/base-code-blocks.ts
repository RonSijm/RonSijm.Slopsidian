import { markdownLanguage } from "@codemirror/lang-markdown";
import type { Tree } from "@lezer/common";

/** An exact, closed top-level fence in the original containing Markdown text. */
export interface BaseCodeBlock {
  readonly from: number;
  readonly to: number;
  readonly line: number;
  readonly source: string;
  readonly configuration: string;
}

/** Nested/indented/unclosed/other-language code remains normal Markdown source. */
export function baseCodeBlocks(source: string, tree: Tree = markdownLanguage.parser.parse(source)): BaseCodeBlock[] {
  const blocks: BaseCodeBlock[] = [];
  tree.iterate({ enter(node) {
    if (node.name !== "FencedCode") { return; }
    if (node.node.parent?.name !== "Document") { return false; }
    const info = node.node.getChild("CodeInfo"), marks = node.node.getChildren("CodeMark");
    if (!info || !/^base$/i.test(source.slice(info.from, info.to).trim()) || marks.length !== 2) { return false; }
    const raw = source.slice(node.from, node.to), opening = /^( {0,3})(`{3,}|~{3,})[ \t]*base[ \t]*(?:\r\n|\n|\r)/i.exec(raw);
    if (!opening) { return false; }
    const close = marks[1], closing = source.slice(close.from, node.to).replace(/\r$/, "");
    if (close.from <= marks[0].to || closing[0] !== opening[2][0] || !new RegExp("^" + opening[2][0] + "{" + opening[2].length + ",}[ \\t]*$").test(closing)) { return false; }
    const beforeClose = source.slice(node.from + opening[0].length, close.from);
    // The closer's optional indentation belongs to the fence, never the YAML.
    const body = beforeClose.replace(/ {0,3}$/, "");
    const lineStart = Math.max(source.lastIndexOf("\n", node.from - 1), source.lastIndexOf("\r", node.from - 1)) + 1;
    const prefix = source.slice(lineStart, node.from);
    const indentation = opening[1].length + (/^ {0,3}$/.test(prefix) ? prefix.length : 0);
    const deindented = indentation ? body.replace(new RegExp("^ {0," + indentation + "}", "gm"), "") : body;
    const configuration = deindented.replace(/^(\t+)/gm, tabs => "    ".repeat(tabs.length));
    blocks.push({ from: node.from, to: node.to, line: source.slice(0, node.from).split(/\r\n|\n|\r/).length - 1, source: raw, configuration });
    return false;
  } });
  return blocks;
}
