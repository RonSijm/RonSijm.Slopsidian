---
tags: [workshop, demo/admonition]
---
# Decision register

Admonition's included custom types give three different planning records a consistent appearance. They are saved in this vault's Admonition settings; enable the plugin and open Reading view.

> [!workshop-decision]+ D-01 · Use one welcome for both stations
> **Decision:** [[70 Data/People/Alex]] welcomes every visitor before they choose the telescope or garden station.
>
> **Reason:** one introduction keeps the explanations short and makes it clear where to ask for help.
>
> **Follow-up:** use [[80 Sandbox/Workshop agenda]] as the host's running order.

> [!workshop-risk]- R-01 · A wet courtyard changes the route
> **Trigger:** the garden station cannot use the courtyard.
>
> **Response:** move the potting demonstration indoors and keep the entrance clear. Compare the room drawing before changing the route.
>
> **Owner:** [[70 Data/People/Sam]]. This is fictional event-planning material.

> [!workshop-experiment]+ E-01 · Ask before explaining
> **Question:** do visitors ask more questions when invited to describe what they notice first?
>
> 1. Use the opening question in [[80 Sandbox/Plugin lab/Search/Visitor briefing]].
> 2. Record one anonymous observation in a copy of the meeting.
> 3. Review the result before changing the welcome script.

## Exercise 1 · Inspect a custom type

Open Admonition settings. Find `workshop-decision`, `workshop-risk` and `workshop-experiment`; compare their icons, colors and default titles. Edit a copy of one callout's title. Its explicit title overrides the type's default title.

## Exercise 2 · Separate detail from the main plan

Open the collapsed risk, change its `]-` marker to `]+` in a copy, and reopen Reading view. The detail changes presentation without creating or completing a task.

## Exercise 3 · Keep the decision portable

The same custom type can be reused for another decision while the plugin is enabled:

> [!workshop-decision] D-02 · Leave the source action in its project
> Link to [[30 Projects/Observatory#Next actions]] from meetings and boards. Keep the actual checkbox in one source note.

Native callout text remains readable without the plugin; the custom colors and icons depend on its type definitions.

## Compare the plugin's fenced form

With Admonition enabled, this fenced form now also renders in Slopsidian Reading view. Compare its formatted title/body, custom colors, visible icon and collapse control with the native form above. Complete native visual equivalence remains separate.

```ad-workshop-decision
title: D-01 · Use one welcome for both stations
collapse: open

**Decision:** keep one welcome for both stations. Record the reason and follow [[80 Sandbox/Workshop agenda|the host's running order]].
```

Fenced blocks use `title:` and `collapse:` fields; native callouts use their header and `+`/`-` markers. Reading/static fenced rendering, links and open/closed controls passed in Slopsidian desktop and WASM on 27 October 2026. Full Live Preview, authoring commands and native visual equivalence remain separate exercises.

[[20 Community/Admonition]] · [[60 Visuals/Workshop room.excalidraw]]
