# Workbench web standards

## Scope

The existing workbench targets WCAG 2.2 Level AA and interoperable semantic HTML. This is a maintenance baseline, not a conformance certification or a feature roadmap. Preserve plain HTML/CSS/JavaScript, local assets, both themes, and the loopback security boundary. No frontend framework or runtime accessibility dependency is required.

## Required practices

- Use native buttons, labeled form controls, headings, landmarks, and dialogs. Keep one meaningful H1 and a logical heading hierarchy. Add ARIA only where native semantics are insufficient; use roles that support the supplied names and states.
- Support keyboard-only review, editing, picker navigation, and cleanup. Preserve logical focus after requests and DOM replacement, move focus into mobile details, and return it to the selected row on Back. Skip navigation must not alter credentials. Pending-request protection must not strand focus, discard drafts, or accept overlapping operations.
- Keep a visible keyboard focus indicator and prevent fixed header/footer elements from fully obscuring focused controls. Do not move a pointer target during a click to implement focus scrolling.
- Meet [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): at least 4.5:1 for ordinary text and 3:1 for qualifying large text. Meet [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html): at least 3:1 for visual information necessary to identify enabled controls and states. Decorative dividers and inactive controls do not have the same requirement. Keep control-border tokens separate from decorative rules.
- Preserve operation and content access at 320 CSS pixels and with [text-spacing overrides](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html). Check 200% text enlargement and browser zoom up to 400% manually, including the picker and fixed chrome. Truncated previews must retain access to full content in details.
- Keep status/error feedback available to assistive technology. Preserve accessible names and expanded/pressed states; do not rely on color alone for selection, errors, or editing authorization. Check minimum target size or permitted spacing under [WCAG 2.2 target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- Apply filters only on explicit submission; Refresh, pagination, store changes, and mutation refreshes use the committed filter state. Clamp pages when records leave the result set.
- Render memory/path/metadata values as text, not HTML. Keep scripts, styles, fonts, and logos local, ship applicable licenses, and retain the asset allowlist, CSP, Host/Origin checks, launch token, no-store, nosniff, and no-referrer headers. Keep normal anchor fragments distinct from credential fragments.

## Automated gates

`npm run validate` remains the read-only repository/package gate. The separate rendered CI/release matrix runs Chromium, Firefox, and WebKit with Python Playwright; every matrix lane must pass before release publishing. `axe-core` is a pinned root development dependency, never a UI runtime dependency. Run the suites from the repository root after installing the repository and Python browser-test dependencies:
```sh
python3 -m pip install playwright==1.62.0
python3 -m playwright install chromium firefox webkit
for browser in chromium firefox webkit; do
  NMNM_UI_BROWSER="$browser" python3 packages/nmnm-ui/test/browser.py &&
  NMNM_UI_BROWSER="$browser" python3 packages/nmnm-ui/test/browser_regressions.py || exit 1
done
```
The existing workflow suite verifies normal review/cleanup behavior. The regression suite verifies credential/anchor reloads, page shrink after remove/purge/expiry, staged filters, keyboard focus restoration, mobile focus handoff, headings/picker semantics, control/focus contrast, and 320px/text-spacing behavior. Axe scans unselected, selected, editing, removed, and picker states in both themes for WCAG A/AA and best-practice rules. Violations fail the gate; incomplete findings remain explicitly recorded for manual review. Evidence is written under the platform temporary directory as `nmnm-ui-<browser>-axe-*.json` and `nmnm-ui-*.png`; CI/release Ubuntu jobs retain available evidence for 7 days.
WebKit's default link tabbing varies with platform keyboard settings. The workflow suite focuses the skip link explicitly in WebKit; activation, credential preservation, control tabbing, and focus recovery still have behavioral coverage. This does not establish default Safari/macOS keyboard settings or native desktop opener behavior.

## Developer notes

### Manual release review

Inspect incomplete axe findings, particularly clipped/offscreen text in the scrollable preview list; automated scans do not certify contrast for every record or state. Check keyboard-only operation, screen-reader announcements and reading order, browser zoom/text enlargement, long paths/content, dialog cancellation, and fixed-chrome focus visibility. Use disposable databases for writes. Record untested platforms and assistive technologies rather than claiming complete WCAG or Windows/native-browser coverage. Keep [focus order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html), [focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html), and [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) as the reference criteria when reviewing changes.
