---
tags: [workshop, demo/highlightr]
---
# Reading review

A prepared annotation pass using Highlightr's inline-style markup. The sample palette names the purpose of a color: **Evidence** (green), **Question** (yellow), **Risk** (red).

## Annotated reading

In the fictional trial, <mark style="background: #BBFABBA6;">visitors described a star pattern before asking for its name</mark>. The host recorded the sequence of the conversation.

<mark style="background: #FFF3A3A6;">Would the same opening question help at the seedling station?</mark> That question belongs in the next planning discussion rather than the list of established observations.

<mark style="background: #FF5582A6;">The earlier draft treats a wet courtyard as a reason to move both stations.</mark> Check the current decision before copying that plan.

## Exercise 1 · Apply a meaningful palette

Open [[80 Sandbox/Plugin lab/Reading review practice]] in an editing mode. Select its observation sentence, open Highlightr's menu and choose Evidence. Annotate the question and outdated-plan sentence with the other two colors.

## Exercise 2 · Reconsider an annotation

Change a sentence from Question to Evidence only after changing its wording to describe an observation. Use the plugin's remove-highlight action on a selection and compare with Undo. The annotation records your reading judgement; the color does not validate the claim.

## Exercise 3 · Inspect and reuse the result

Compare the stored `<mark>` elements with the prepared version here. Inline-style colors depend on the host's HTML/style rendering. Extract a useful sentence with Note Refactor, then deliberately classify or link the resulting note; highlighting does not perform that step automatically.

[[20 Community/Highlightr]] · [[80 Sandbox/Plugin lab/Note Refactor/Note Refactor]]
