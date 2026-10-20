import { defaultHighlightStyle, ParseContext, StreamLanguage, syntaxHighlighting, TreeIndentContext, type StreamParser } from "@codemirror/language";
import type { Input, PartialParse } from "@lezer/common";
import { Tag, tags } from "@lezer/highlight";
import type CodeMirror from "codemirror";

const standardTags: Readonly<Record<string, Tag>> = {
  keyword: tags.keyword, atom: tags.atom, number: tags.number, string: tags.string,
  "string-2": tags.special(tags.string), variable: tags.variableName, "variable-2": tags.special(tags.variableName),
  def: tags.definition(tags.variableName), property: tags.propertyName, operator: tags.operator,
  comment: tags.comment, meta: tags.meta, tag: tags.tagName, attribute: tags.attributeName,
  type: tags.typeName, builtin: tags.standard(tags.variableName), qualifier: tags.modifier,
  error: tags.invalid, header: tags.heading, "header-1": tags.heading1, "header-2": tags.heading2,
  "header-3": tags.heading3, "header-4": tags.heading4, "header-5": tags.heading5, "header-6": tags.heading6,
  strong: tags.strong, em: tags.emphasis, strikethrough: tags.strikethrough, link: tags.link,
  quote: tags.quote, hr: tags.contentSeparator,
};

interface ParseInput { partial: PartialParse; lines: string[]; offsets: number[] }

function parseInput(input: Input, partial: PartialParse): ParseInput {
  const lines = input.read(0, input.length).split("\n");
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  return { partial, lines, offsets };
}

function lookAhead(input: ParseInput, count: number): string | undefined {
  if (!Number.isInteger(count)) { throw new Error("Classic tokenizer look-ahead needs an integer line offset."); }
  let low = 0, high = input.offsets.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (input.offsets[middle] <= input.partial.parsedPos) { low = middle; } else { high = middle; }
  }
  return input.lines[low + count]?.replace(/\r$/, "");
}

export function installClassicStreamLanguages(classic: typeof CodeMirror): void {
  const modes = new WeakSet<object>();
  const getMode = classic.getMode;
  classic.getMode = (configuration, specification) => {
    const mode = getMode(configuration, specification);
    modes.add(mode);
    return mode;
  };
  const define = StreamLanguage.define;
  function classicMode<State>(specification: StreamParser<State>): specification is StreamParser<State> & CodeMirror.Mode<State> {
    return modes.has(specification);
  }
  StreamLanguage.define = function<State>(specification: StreamParser<State>): StreamLanguage<State> {
    if (!classicMode(specification)) { return define(specification); }
    const mode: CodeMirror.Mode<State> = specification;
    const tokenTable: Record<string, Tag> = {};
    const tokens = new Map<string, string>();
    const classes = new Map<Tag, string>();
    const streams = new WeakMap<object, CodeMirror.StringStream>();
    const startState = mode.startState?.bind(mode);
    let active: ParseInput | null = null;
    const language = define<State>({
      name: mode.name, startState: startState ? () => startState() : undefined, copyState: mode.copyState?.bind(mode),
      blankLine: state => mode.blankLine?.(state), languageData: specification.languageData, tokenTable,
      indent(state, after, context) {
        const line = context instanceof TreeIndentContext ? context.lineAt(context.pos).text : after;
        const indentation = mode.indent?.(state, after, line);
        return typeof indentation === "number" ? indentation : null;
      },
      token(stream, state) {
        const input = active;
        const oracle = input ? {
          lookAhead: (count: number) => lookAhead(input, count),
          baseToken: () => { throw new Error("Classic overlay base-token queries are not implemented by this editor bridge."); },
        } : undefined;
        let legacy = streams.get(stream);
        if (!legacy) {
          // Classic modes can keep per-line state keyed by the stream object.
          const created: unknown = Reflect.construct(classic.StringStream, [stream.string, ParseContext.get()?.state.tabSize ?? 4, oracle]);
          if (!(created instanceof classic.StringStream)) { throw new Error("The classic tokenizer did not create a StringStream."); }
          streams.set(stream, legacy = created);
        }
        legacy.pos = stream.pos; legacy.start = stream.start;
        const style = mode.token(legacy, state);
        stream.pos = legacy.pos; stream.start = legacy.start;
        if (!style) { return null; }
        let token = tokens.get(style);
        if (!token) {
          token = `classic${tokens.size}`;
          const tag = Tag.define();
          const names = style.split(/\s+/).filter(Boolean);
          const standard = names.flatMap(name => Object.hasOwn(standardTags, name) ? [standardTags[name]] : []);
          tokenTable[token] = tag;
          classes.set(tag, [...names.map(name => `cm-${name}`), defaultHighlightStyle.style(standard)].filter(Boolean).join(" "));
          tokens.set(style, token);
        }
        return token;
      },
    });
    const createParse = language.parser.createParse.bind(language.parser);
    language.parser.createParse = (input, _fragments, ranges) => {
      // A following-line change can invalidate classic look-ahead before a modern cached fragment.
      const partial = createParse(input, [], ranges);
      const context = parseInput(input, partial);
      return {
        get parsedPos() { return partial.parsedPos; },
        get stoppedAt() { return partial.stoppedAt; },
        stopAt(position) { partial.stopAt(position); },
        advance() {
          const previous = active; active = context;
          try { return partial.advance(); } finally { active = previous; }
        },
      };
    };
    if (!Array.isArray(language.extension)) { throw new Error("The installed stream language cannot carry classic highlighting."); }
    language.extension.push(syntaxHighlighting({
      style: styles => [...new Set(styles.flatMap(tag => { const value = classes.get(tag); return value ? [value] : []; }))].join(" ") || null,
    }), syntaxHighlighting(defaultHighlightStyle));
    return language;
  };
}
