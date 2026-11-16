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

The retained-draft screenshot follows real native editor input with autosave disabled, an application restart after removing the synthetic original, and opening Recover drafts. The recovered copy was then saved through the native window and its persisted profile state verified. No user files or desktop input were involved.

Vault-trash screenshots show real native previews, multiple selection and review of the selected destination folder. Both synthetic notes were then restored through the reviewed native action and their saved contents/location checked. External-change refusal and partial success are exercised by headless widget tests.
