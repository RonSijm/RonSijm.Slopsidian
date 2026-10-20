# Pinned Lucide SVG catalog

The application serves the unmodified `sprite.svg` and ISC license from
`lucide-static@0.468.0` as `wwwroot/lucide-icons.svg` and
`wwwroot/lucide-icons-LICENSE.txt`. The archive's SHA-512 integrity, upstream
file hashes and committed output hashes are in [provenance.json](provenance.json).

Reproduce the import from the official npm archive without executing its code:

```powershell
npm pack lucide-static@0.468.0 --pack-destination .runtime --ignore-scripts
python tools/import-lucide-icons.py .runtime/lucide-static-0.468.0.tgz
```

The importer verifies archive integrity, validates allowed SVG elements, copies
the sprite/license verbatim and derives kebab-case aliases from the package's
ES-module exports. No package JavaScript is executed. `tools/build.mjs` checks
all committed output hashes before building.

The upstream sprite has 1,544 symbols; 210 generated alias mappings are included
in `client/lucide-icon-aliases.ts`. Existing shell IDs/templates retain priority,
so legacy `edit` keeps its current drawing. The combined catalog advertises
1,558 builtin IDs. This is a pinned release, not a claim about the exact icon
version or inventory of the reference application. Upstream documentation:
[Lucide packages](https://lucide.dev/packages).
