# GitHub vault browser probe

A standalone browser experiment before integrating GitHub vaults into Slopsidian.
It has no build step, dependencies, Git implementation, credentials, or GitHub proxy.

From the repository root:

```powershell
node tools/github-vault-probe/serve.mjs
```

Open `http://127.0.0.1:5184/` in a normal browser. The server binds to loopback only
and serves the sample HTML. Every GitHub request originates in the browser using
`fetch` with `mode: "cors"` and `credentials: "omit"`. Browser security stays enabled.
The request evidence records HTTP status, response type, and readable content.
An opaque `no-cors` response cannot pass the checks.

## What to try

1. Click **Mount from GitHub**. It resolves `main` to a commit and fetches the
   recursive tree: two anonymous API requests, zero raw file downloads.
2. Click **Start here.md**. Only that file's content is fetched from
   `raw.githubusercontent.com`, pinned to the discovered commit.
3. Open **90 Attachments/Vault map.svg** and **90 Attachments/Synthetic tone.wav**
   to test binary response access and actual image/audio decoding. Audio does not
   play automatically.
4. Open the note again: its bytes come from Cache Storage.
5. Reload the page, enable **Cache-only**, click **Reopen cached mount**, and open
   the same note. The tree survives in IndexedDB; file responses survive in Cache
   Storage. Cache-only mode rejects any request that would contact GitHub.
6. **Run Example checks** performs the discovery, lazy loading, media decoding,
   and cache-only checks together. A fresh run needs two API calls and at most
   three raw downloads. Subsequent runs can use already cached file bytes.

The evidence panel includes request counts and destinations. Cached bytes are
checked against their discovered Git blob SHA, including Git's blob header.

## Verified result — October 26, 2026

Tested from `http://127.0.0.1:5185` in the Codex in-app Chromium 156 browser on
Windows. All six automated Example checks passed:

- 112 visible file references discovered with two anonymous API requests and
  zero raw file downloads during mounting.
- Three raw responses (Markdown, SVG, WAV) returned HTTP 200 and response type
  `cors`; their bodies matched the tree hashes. The image and audio decoded.
- After a full page reload, the mount and note reopened with zero API requests,
  zero raw downloads, and one cache hit.
- Opening an uncached file in cache-only mode was refused without contacting
  GitHub. No GitHub proxy, sign-in, or CORS bypass was used.

See [the captured report](browser-results.json) and
[the results screenshot](browser-results.png). The report records the exact
commit tested. Firefox and Safari have not been verified.

## Scope

- Public repositories only; no token or OAuth workflow.
- This is a proof of browser access, not a Slopsidian implementation or a claim
  that every browser, network, or deployment policy is supported.
- Files are lazy references until opened. There is no background Markdown index.
- Dotfiles and symlinks/submodules are omitted. A truncated repository tree fails
  explicitly; production discovery will need subtree fallback.
- Cache Storage is used for response bodies, IndexedDB for the mount inventory.
  Browser storage can be evicted; cached content is not guaranteed offline storage.
- The generic `fetch` exception alone cannot identify CORS versus DNS, connectivity,
  or a browser policy. Check the browser console when a request fails.
- No Slopsidian application source is changed by this experiment.
