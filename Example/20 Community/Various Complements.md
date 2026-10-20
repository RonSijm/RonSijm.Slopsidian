---
type: community-guide
plugin_id: various-complements
tags: [tour/community]
---
# Various Complements

> [!info] Included plugin — enable it to try this
> Enable the included **Various Complements** (`various-complements`) for this exercise. Reference version: **11.4.2**. Minimum Obsidian: **1.11.4**. See [[00 Start/Install community plugins]].

The profile now enables current-vault vocabulary, internal-link aliases and a local custom dictionary: [[70 Data/Workshop dictionary.json]]. The JSON has six entries, including described terms, searchable aliases, full-sentence expansions and a cursor marker. It contains no remote dictionary URL.

## Complete the project's vocabulary

In [[80 Sandbox/Plugin lab/Completion practice]], type `constell` or `spectro` and choose a dictionary entry. Compare its description with suggestions from [[70 Data/Word bank]] and other vault notes.

## Expand a short trigger into useful text

Type `wswelcome` and accept Workshop welcome. The short displayed label inserts a complete public welcome sentence. Try its `welcome-script` alias to reach the same entry. `wsclosing` inserts the closing question.

## Leave the caret at the next decision

Accept Workshop decision using `wsdecision`. The inserted outline has Decision, Reason and Owner lines; its configured `¦` marker is removed and positions the caret for the decision text. Inspect the actual Markdown and linked owner.

## Find a note by an alias

Start an internal link and search for Welcome script. The enabled alias option points to Visitor briefing. Compare the stored target and display label; choosing a suggestion should not create an unrelated note.

These examples distinguish current-file words, vault terms, custom dictionary entries and note links. Completion inserts text; Metadata Menu governs its own field editors. Undo practice insertions to reset, and edit the JSON only when you want to change the shared local vocabulary.

[Custom dictionary format](https://github.com/tadashi-aikawa/obsidian-various-complements-plugin/blob/11.4.2/src/provider/CustomDictionaryWordProvider.ts)

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://tadashi-aikawa.github.io/docs-obsidian-various-complements-plugin/) · [Exact release](https://github.com/tadashi-aikawa/obsidian-various-complements-plugin/releases/tag/11.4.2)
