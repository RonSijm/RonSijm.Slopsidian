# Date planning worksheet

Natural Language Dates is configured to use `YYYY-MM-DD`, `HH:mm`, the `@` suggestion trigger and Monday as the start of the week. Try the editing actions on a copy so the phrases remain available for comparison.

## Exercise 1 · Resolve an absolute date

Select the phrase below and run the plugin's parse-date command. The expected date is **2026-10-23**, independent of today's date. If the chosen action creates a link, it can resolve to the existing daily note.

October 23, 2026

Saved result to compare: [[40 Journal/Daily/2026-10-23|23 October daily note]].

## Exercise 2 · Capture a relative deadline

Select each phrase separately and parse it:

tomorrow

next Friday

in two weeks

Record the actual resolved date beside the phrase. These depend on the current date and parser rules; the fixed project deadlines are not the expected answers.

## Exercise 3 · Capture a time as well

Select `19:30` and run **Parse natural language time**. The time-only result is **19:30**. On another empty line run **Insert the current date and time**; that command records the actual clock as `YYYY-MM-DD HH:mm`, rather than a selected historical date. Compare these with date-only parsing to see which information each command retains.

The pinned parser returned **20:30** when given the historical phrase `October 23, 2026 at 19:30` in the reference run. That is an observed edge case, not the expected answer for the time-only exercise. Check dated timestamp results in your host/locale before copying them into an event plan.

## Exercise 4 · Use suggestions while writing

On an empty line type `@tomorrow`, inspect the suggestion and accept it. The supplied suggestion setting inserts a date link. A selected-phrase command can instead insert plain date text, depending on the action you choose.

## Exercise 5 · Turn a resolved date into a real task deliberately

In a copy of [[80 Sandbox/Task inbox]], use Tasks' date editor to set a due date. Compare its `📅 YYYY-MM-DD` marker with a Natural Language Dates link. A date link alone is not a Tasks due-date property.

[[20 Community/Natural Language Dates]] · [[80 Sandbox/Workshop agenda]]
