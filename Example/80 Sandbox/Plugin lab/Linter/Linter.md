# Linter lab

[[80 Sandbox/Plugin lab/Linter/Raw briefing]] and [[80 Sandbox/Plugin lab/Linter/Clean briefing]] show the same short document before and after a deliberate formatting pass. They are separate files so you can compare without immediately changing the source.

The included Linter profile enables heading spacing, trailing-space cleanup, consecutive-blank-line cleanup, YAML array deduplication/sorting and table alignment. Lint-on-save and lint-on-file-change remain off. Run a manual command on a copy of Raw briefing.

## Exercise 1 · Clean a draft

Run **Linter: Lint the current file**, inspect its diff preview if offered, and compare the result with Clean briefing. The content should remain, headings and paragraphs should have clear spacing, and trailing spaces should be removed.

## Exercise 2 · Normalize repeated metadata

Inspect Source mode before and after. The repeated `workshop` tag and duplicate alias should become unique list values. Sorting changes presentation of the arrays; it does not choose a project status or add a fileClass.

## Exercise 3 · Preserve a table's meaning

Compare the pipe alignment of the two table rows. Formatting aligns their source columns; the fictional counts remain 2 and 3. Advanced Tables' arithmetic is a separate workflow.

## Exercise 4 · Choose a rule, then review its effect

Undo in your practice copy, disable just one of the supplied manual rules, and lint again. Inspect which part of the diff disappears. Restore that rule after the experiment. Avoid a whole-vault lint while learning the profile: templates and class definitions are Markdown too.

Clean briefing was retained from the real plugin command with the supplied profile in the Slopsidian check. It is a reference layout, not a promise of byte-for-byte output across every plugin release or custom rule combination.

[[20 Community/Linter]] · [[80 Sandbox/Plugin lab/Git/Git]]
