# Shared modal viewport containment

[Feature-parity index](../FEATURE-PARITY.md) · [Keyboard accessibility](MODAL-ACCESSIBILITY.md)

**Ownership:** Codex, claimed and completed 2026-10-25.

Ordinary shared Modal dialogs now fit the available viewport and scroll their
contents when a form is too tall or wide. The overlay uses a definite grid area
with shrinkable tracks; the dialog has bounded width/height, zero automatic
minimums and its own scroll container. A 16px outer gutter becomes 8px in
windows at most 480px wide or high, and dialog padding drops from 30px to 20px.
The normal 520px desktop width is retained when space permits.

Long unbroken titles wrap without changing their text, with space reserved on
the physical right for the close button in both LTR and RTL titles. Empty headings
add no blank title margin. Literal preformatted
code and wide tables remain horizontally scrollable; their whitespace/content
is not rewritten or truncated. Existing subclasses keep their own flex/content
scrolling rules, and ordinary focus navigation reveals offscreen controls using
the [shared keyboard behavior](MODAL-ACCESSIBILITY.md).

The layout change does not recreate a dialog during resizing. Draft input and
form values, the invoking control, nested focus restoration and ordinary
confirmation actions remain in the existing Modal instance. Open menus and
top-layer input suggestions retain their own keyboard handling after a parent
dialog scrolls. The CSS adds no persisted state or vault-format changes.

## Actual checks and bounds

The real fixture plugin uses the shared Modal and ConfirmationModal API, real
pointer/Tab/Escape/Enter input, DOM text-range/geometry assertions and these CSS
viewports on both desktop and standalone WASM:

| Width × height | Exercised layout |
|---|---|
| 320 × 568 | Long title/form, wide code/table, nested dialog and owned popups. |
| 640 × 240 | Short-window form and separately appended confirmation footer. |
| 320 × 240 | Simultaneously narrow/short live resize with retained draft. |
| 1280 × 800 | Return to large layout without recreating or losing the form. |

Seven feature groups pass per host, including final-action reachability,
horizontal/vertical scrolling, exact title/code text, nested focus, draft
preservation and note/plugin preservation through disable and native restart
or actual-folder browser reconnect. Desktop has eight checks across three
sessions and fifty-eight bound artifacts. WASM has twenty checks (including
thirteen bootstrap checks), twenty-two assets and thirty scenario/source inputs.
All 511 regression tests pass. Existing keyboard, Note composer (including
Menu) and suggestion suites pass again on both hosts: eight actual UI reports
in total. Six final captures and the cropped baseline have been visually
reviewed. The 496-file isolated snapshot retains 26 unchanged contributor/prior
feature inputs; all five layout source/harness inputs match the shared tree.
The rest of the CSS is verified byte-exact outside the owned modal block.
Native/WASM builds and static serving pass. Full details are recorded in the [evidence index](../Engineering/EVIDENCE.md#shared-modal-viewport-containment).

The retained baseline demonstrates a 1160px-high dialog extending beyond the
320 × 568 viewport, with a horizontally overflowing title. The corrected run
keeps the dialog within the viewport and makes its controls reachable. The
initial confirmation fixture returned an array length, correctly requesting
that ConfirmationModal stay open; its void callback correction and prior
report/input/capture are retained separately from the CSS fix.

Final directional review also reproduced RTL title text beneath the right-side
close button. Reserving physical right padding fixes that overlap; real text
rectangles must now remain visible and clear of the control. The diagnostic
fixture settles title layout before resetting scroll, avoiding deferred scroll
anchoring in the capture. Earlier passing inputs/reports and the isolated RTL
failure remain retained. One review command accidentally used the shared smoke
checkout and a disposable test vault; it did not rebuild shared outputs and is
excluded from acceptance. The same failure and final checks run in isolation.

A later browser cleanup attempt missed its settings click immediately after
clearing viewport emulation. The final fixture waits for original dimensions
and two animation frames before cleanup; it also asserts the last dialog has
closed. This changes no product CSS. The attempt and its inputs remain retained.

The viewport changes use CDP device metrics in the actual desktop/WASM
renderer, with device scale 1 and mobile emulation off. This is not acceptance
of physical OS-window resizing, display scaling, browser zoom or virtual
keyboards. Complete application reflow, physical device/IME/touch behavior,
native dialogs, arbitrary plugin CSS overrides, every custom modal subclass,
full screen-reader behavior and original-runtime equivalence remain separate.
Release readiness remains outstanding.
