# Native Linux UI captures

Real Avalonia windows captured on an isolated Linux Xvfb display using a synthetic
Slopsidian demo vault. The native port is still in progress.

| Image | Workflow |
| --- | --- |
| workspace.png | File tree, independent document tabs, source editor and outline |
| reading.png | Markdown rendered with native controls |
| search-properties.png | Typed-property search and YAML property panel |
| graph.png | Linked and orphan notes in the native graph |
| settings.png | Native Files and links controls |

UI source: aaf4058. The demo contains no personal notes. The application logo is
maintained in `src/RonSijm.Slopsidian.Linux/Assets/tux-notebook.png` and its exact
generation prompt is retained with that asset.

Saved-file recovery captures show native version selection and an explicit restore review. The demo history was created by the real native recovery commands on the same isolated display. Restore behavior is covered by the 114-test regression suite; strict lint/Release build passed with zero warnings/errors.
