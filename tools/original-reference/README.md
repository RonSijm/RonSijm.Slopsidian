# Original floating-window reference capture

This Windows-only controller stages and captures the pinned Obsidian **1.12.7**
reference in a disposable Windows Sandbox. It does not run the original app on
the host. The application under development does not depend on these binaries.

## Stage a capture

The ignored `.runtime/obsidian-1.12.7/` directory must contain the official
`Obsidian-1.12.7.exe`, `release-metadata.json` and its extracted `app/` tree.
Staging checks the pinned installer and inner ASAR hashes against the recorded
release metadata, hashes every payload file and verifies the copies. Node is
copied from the current process executable.

```powershell
npm run test:reference
npm run reference:stage
```

The second command only writes a fresh
`.runtime/original-reference-captures/<id>/` directory. It prints the generated
`capture.wsb` location and content hashes. It never launches the original app.
Do not substitute a personal installation or profile for these inputs.

## Run and review

On a machine with Windows Sandbox already available, inspect the generated
configuration, then open that exact `capture.wsb`. Its only mappings are the
fresh read-only input directory and separate empty output directory. Network,
clipboard, audio/video input, printer redirection and virtual GPU are disabled.
The guest checks its Windows Sandbox account, VM identity, nonce and fresh
application/vault/profile paths before copying or executing anything.

The guest verifies the original runtime version and ASAR, creates one floating
Markdown window through the original workspace API, and records native bounds
and exact workspace bytes before and after a normal app close. Review
`output/result.json`, `workspace.floating-open.json` and
`workspace.after-close.json`. Acceptance requires matching provenance hashes,
`ok: true`, a separate floating window, exit code zero, no signal, no forced
cleanup and an empty close-error list. A CDP disconnect alone is not a clean
exit; a genuine protocol refusal remains a failure even if the child exits.

Close the owned Sandbox normally after the capture and confirm its processes
have exited. Keep the raw capture and binaries local and ignored. A fresh
capture supplements the retained test fixture; replacing that fixture requires
review of its actual layout/state differences. This one-window/default-zoom
observation does not establish other display, zoom, maximization or import
combinations.
