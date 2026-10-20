# Diagram workshop

Mermaid Tools includes a prepared **Workshop** toolbar category with three reusable flowchart fragments: the two-station route, a weather decision and the review loop. Built-in toolbar elements remain available. Open **Mermaid: Open Toolbar View**, choose Workshop and insert a fragment into a new fenced `mermaid` block.

## Exercise 1 · Reuse a meaningful fragment

In a new note, start a fenced Mermaid block with only `flowchart LR`, put the caret on its next line and insert the two-station fragment from the toolbar. This is the prepared result to compare with:

```mermaid
flowchart LR
  welcome[Welcome desk] --> telescope[Telescope station]
  welcome --> garden[Seedling station]
  telescope --> closing[One discovery]
  garden --> closing
```

Change `LR` to `TD`, add one node using a built-in toolbar element, and inspect the actual Markdown inserted by the plugin. The toolbar inserts source; it does not assign tasks to hosts.

## Exercise 2 · Keep a decision visible

The weather fragment makes the indoor alternative explicit:

```mermaid
flowchart TD
  weather{Courtyard dry?}
  weather -->|Yes| courtyard[Use courtyard station]
  weather -->|No| indoor[Move potting demonstration indoors]
  courtyard --> clear[Keep the entrance clear]
  indoor --> clear
```

Edit a copy of this element through Mermaid Tools settings, change its description, and move it within the custom category. Reinsert it into a new note to see the saved element change. Existing diagrams keep their own text.

## Exercise 3 · Explain status separately from task completion

```mermaid
stateDiagram-v2
  [*] --> planned
  planned --> active: hosts and room confirmed
  active --> done: review recorded
  done --> [*]
```

Compare the state diagram with the actual Project class's `planned`, `active` and `done` choices. Edit the diagram source or try a state element from the built-in toolbar. The drawing documents the rule; it does not change frontmatter.

## Exercise 4 · Show handover order and a fixed timeline

```mermaid
sequenceDiagram
  participant Visitor
  participant Alex
  participant Sam
  Visitor->>Alex: What can I discover?
  Alex-->>Visitor: Describe a pattern
  Visitor->>Sam: How will this seedling change?
  Sam-->>Visitor: Make one prediction
  Visitor->>Alex: Share one discovery
```

```mermaid
gantt
  title Fictional workshop preparation
  dateFormat YYYY-MM-DD
  section Prepare
  Confirm hosts :hosts, 2026-11-09, 2d
  Print signs :signs, after hosts, 2d
  section Rehearse
  Shared welcome :welcome, 2026-11-13, 1d
  Review plan :review, after welcome, 1d
```

The sequence shows who speaks next; the Gantt chart shows a fixed preparation schedule. Add another exchange or change a task duration in a copy and compare the rendered result. Native Mermaid renders all five blocks; plugin toolbar insertion and element management are the additional features demonstrated here.

[[20 Community/Mermaid Tools]] · [[60 Visuals/Workshop workflow]] · [[80 Sandbox/Plugin lab/Plugin lab]]
