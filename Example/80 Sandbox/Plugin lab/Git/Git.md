# Git history lab

A portable local repository is included as [[90 Attachments/Workshop history.bundle]]. It contains fictional workshop notes, three commits on `main`, and a separate `indoor-route` branch. The bundle contains no application source, credentials or remote configuration.

## Prepare the separate vault

This Example folder belongs to the Slopsidian application repository. Use a new directory outside Example for staging, committing and branch exercises.

With PowerShell 7 and desktop Git installed, run the included helper from the Example folder, replacing the destination with a new path of your choice:

```powershell
& '.\90 Attachments\Create Git lab.ps1' -Destination 'D:\temp\Workshop Git lab'
```

The helper refuses an existing destination or one inside Example. It clones the **local bundle**, removes its local `origin` entry, copies the installed Git plugin and prepares the lab with push disabled and automatic routines off. Open that new folder as a separate vault and enable its included Git plugin through the usual trust controls. No network service or account is needed.

## Exercise 1 · Understand a real history

Open `Visitor brief.md` in the lab and use Git's file-history view. Compare the original explanation-first welcome with the later observation-first wording. Open `Room decision.md` and inspect the commit that added the indoor fallback. Use blame/line-history controls where the host provides them to connect a line with its change.

**Expected:** actual repository commits provide the old and new text. A file diff is about that file; a repository history can include several files in one decision.

## Exercise 2 · Review a working edit

Change one sentence in Visitor brief and one in Host checklist. Refresh source control manually. Inspect both diffs, stage only Visitor brief, then compare staged and unstaged changes. Unstage it and verify that the edited text is still present.

**Expected:** staging changes what a future commit would include; unstaging does not undo the note edit. Use a local commit only if you want to preserve that practice change in this separate lab.

## Exercise 3 · Compare two plans

Start from a clean lab working tree. Compare the local `main` and `indoor-route` branches. The helper preserves both before removing its local bundle origin. Inspect the room decision and welcome wording on each revision before switching branches.

The branches represent different plans; a branch switch can change note contents on disk. Do this only in the lab. There is no remote to fetch from or push to.

## Exercise 4 · Separate notes from session data

The lab's `.gitignore` excludes its `.obsidian` folder. Inspect that decision before copying it into a real vault: plugin configurations and personal history have different sharing needs. The application Example intentionally versions plugin packages and sample configuration, so it uses a different ignore policy.

[[20 Community/Git]] · [[80 Sandbox/Plugin lab/Linter/Linter]]
