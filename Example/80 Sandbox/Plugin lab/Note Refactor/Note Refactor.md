# Note Refactor lab

[[80 Sandbox/Plugin lab/Note Refactor/Practice draft]] is a deliberately long planning note. The prepared [[80 Sandbox/Plugin lab/Note Refactor/Expected/Expected|result notes]] show a useful end state; the configured extraction destination is `80 Sandbox/Plugin lab/Note Refactor/Extracted`.

## Exercise 1 · Extract one named idea

Copy Practice draft. Select the Welcome script heading and its paragraphs, then run **Extract selection to new note — first line as filename**. The plugin derives the name from that heading, writes a note in Extracted and replaces the selection with a link.

Inspect the source and new note. The source should retain its other sections, and the extracted text should retain its project links. Open the replacement link to verify the destination.

## Exercise 2 · Split a draft at a deliberate boundary

Use another copy. Put the cursor at Equipment handover and run the split-here command. This takes the remaining tail into a new note, rather than extracting only the paragraph you selected in exercise 1.

## Exercise 3 · Split by section

Use a fresh copy and run **Split note by headings — H2**. Each second-level section becomes a note; the third-level Telescope and Garden headings belong to Equipment handover. Compare with the prepared reference notes. Delete previous practice outputs or choose fresh names before repeating, so naming conflicts do not obscure the result.

## Exercise 4 · Keep context as a link or embed

The supplied configuration uses ordinary links and preserves text; it does not add fileClasses or project properties. Try the plugin's transclude-by-default setting on a disposable copy, repeat one extraction, and inspect the `![[...]]` replacement. Restore that setting after comparing the results.

Use copies for all four exercises: extraction and splitting intentionally change the source draft. [[20 Community/Note Refactor]] explains settings and command choices.
