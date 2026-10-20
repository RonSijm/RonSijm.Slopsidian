import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { NodeProp } from "@lezer/common";

export const tokenClassNodeProp = new NodeProp<string>();
export const markdownSupport = markdown({
  base: markdownLanguage,
  extensions: [{
    props: [tokenClassNodeProp.add({
      Link: "link",
      Autolink: "link",
      URL: "url",
      LinkMark: "formatting-link",
    })],
  }],
});
