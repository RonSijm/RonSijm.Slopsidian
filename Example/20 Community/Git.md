---
type: community-guide
plugin_id: obsidian-git
tags: [tour/community]
---
# Git

> [!info] Included plugin — enable it to try this
> Enable the included **Git** (`obsidian-git`) for this exercise. Reference version: **2.42.0**. Minimum Obsidian: **1.13.0**. See [[00 Start/Install community plugins]].

This lab now includes a **real portable repository history**, not only an instruction to change a sandbox note. [[90 Attachments/Workshop history.bundle]] contains fictional notes, three `main` commits and a divergent `indoor-route` commit.

## Create the separate local lab

Follow [[80 Sandbox/Plugin lab/Git/Git]]. Its included PowerShell helper clones the local bundle into a new folder outside Example, preserves both local branches, removes the bundle origin and copies the installed Git plugin. The lab has no remotes, push disabled and automatic Git routines off. Enable the plugin yourself in that separate vault.

Desktop Git and a host compatible with the plugin are required. The helper requires PowerShell 7. It does not install software, update the application repository or connect to an external service.

## Inspect a meaningful history

Compare Visitor brief before and after the observation-first welcome, then inspect Room decision's rain fallback. Use file history, repository history and line attribution where available to answer different questions about the same actual commits.

## Stage and unstage an intentional edit

Edit two lab notes, refresh source control manually and inspect their diffs. Stage only one, compare staged/unstaged changes, then unstage it without discarding the edited text. Commit locally only if you want to preserve that practice change.

## Compare an alternate plan

With the lab clean, compare `main` and `indoor-route`. Inspect the changed note text before switching branches. The bundle and lab's ignore file make it possible to distinguish versioned notes from untracked plugin/session data.

The original Example folder is inside the Slopsidian application repository, so its normal diff can include source changes beyond the vault. Keep branch and commit exercises in the separate lab; no fetch, pull, push or credentials are part of these demos.

---
[[00 Start/Community tour|All community examples]] · [[Start here]]

[Upstream documentation](https://publish.obsidian.md/git-doc/) · [Exact release](https://github.com/vinzent03/obsidian-git/releases/tag/2.42.0)
