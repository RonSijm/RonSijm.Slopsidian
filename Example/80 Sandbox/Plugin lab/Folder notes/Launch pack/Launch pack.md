# Launch pack

This is a same-name note inside its folder. Folder notes makes the folder itself open this landing page. The pack has a running order, a handover sheet and a nested Materials folder.

## Live contents

```folder-overview
id: workshop-pack-list
folderPath: 80 Sandbox/Plugin lab/Folder notes/Launch pack
title: Notes in the launch pack
showTitle: true
depth: 2
includeTypes: [folder, markdown]
style: list
sortBy: name
sortByAsc: true
showEmptyFolders: false
showFolderNotes: false
autoSync: true
useActualLinks: false
```

## Explorer-style contents

```folder-overview
id: workshop-pack-explorer
folderPath: 80 Sandbox/Plugin lab/Folder notes/Launch pack
title: Pack explorer
showTitle: true
depth: 3
includeTypes: [folder, markdown, pdf]
style: explorer
sortBy: name
sortByAsc: true
showEmptyFolders: false
showFolderNotes: false
autoSync: true
useActualLinks: false
```

## Exercise 1 · Navigate a folder as a note

Open this folder using Folder notes' configured click action. Follow [[80 Sandbox/Plugin lab/Folder notes/Launch pack/Materials/Materials|Materials]] to a second folder note. Compare with expanding the tree without opening its note.

## Exercise 2 · Change an overview's scope

Use Edit overview on a copy. Change depth from 2 to 1, compare the visible nested content, then choose only Markdown files or switch list/explorer style. Each block has its own saved ID and settings.

Create a temporary child note in a copy of the pack, reopen the overview as needed, and see it join the list without adding a wiki link manually. `useActualLinks` is false, so these live views do not continually rewrite hidden link lists into the source note. Plain links below remain available independently.

## Exercise 3 · Rename a disposable folder pack

Copy this folder, then rename the copied folder through the explorer. The enabled folder-name synchronization should keep its folder note's name aligned; inspect the result and its links. Check literal `folderPath` values in copied overview blocks and change them to the new pack location when necessary. Do not rename the original lab to perform this exercise.

[[80 Sandbox/Plugin lab/Folder notes/Launch pack/Running order]] · [[80 Sandbox/Plugin lab/Folder notes/Launch pack/Host handover]] · [[20 Community/Folder notes]]
