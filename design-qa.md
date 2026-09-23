# AYRA Website + Desktop UI review — 2026-09-23

## Scope and visual targets

Website follows the third Calm Narrative concept in design-system/concepts/website and the user’s later instruction to begin development. Desktop uses AYRA0–AYRA3 as approximate layout/brand references; their populated business data is not implemented or copied into runtime states. Supplied charcoal/porcelain logo files remain authoritative.

This review covers the implemented interface, not M1–M12 business functionality, production readiness, a native OS usability certification, or the unimplemented populated states.

## Local engineering evidence

- Full pnpm check passed: ESLint, architecture boundaries, format, workspace typechecks, 19 deterministic tests, and all workspace builds.
- Four marketing routes return HTTP 200; /chat, /work, /build, /projects and /settings return 404 on the website.
- Native builds are separately checked in GitHub Actions; the earlier 923601b run is not evidence for this UI revision.

## Browser evidence

Screenshots are stored locally in .local/product-qa (not published as source): website-home, home-mobile, product-mobile, product-tablet, download-mobile, security-mobile, desktop-home, desktop-chat, desktop-work, desktop-build. Captures were inspected, not merely created.

- Desktop browser composition reviewed at the normal approximately 1440 CSS-pixel viewport. No fabricated users, task counts, progress, sources, approvals or passing project tests.
- Website Home/Product/Download/Security measured at 390 CSS pixels: content width 374 pixels excluding the scrollbar, no horizontal overflow. Product tablet measured at 768 CSS pixels, content width 751. Mobile menu and both unavailable installer controls checked.
- Browser retains a 93% zoom. Screenshot emulation sometimes produces a stale cropped frame immediately after navigation. The inspected captures were retaken after state settled. Reported widths are measured DOM/CSS values rather than requested capture dimensions. Temporary overrides were cleared.
- Desktop minimum-width layout measured at 900 CSS pixels with content width 900. Main task surfaces remain desktop layouts; no mobile desktop clone is offered.
- Verified overview opening, step advance, Escape dismissal and focus return; mobile menu route selection; search query → Enter → Build; Projects → Artifacts; Chat suggestion → editable draft → honest unavailable-service notice; Context hide/show; Work draft + Insights; Build Tests empty state; Activity Approvals filter; compact navigation surviving route changes.
- Desktop verification tab console returned no errors or warnings during interactions. A stale Next dev route error from deleting the old workspace pages was cleared by restarting the dev server; production build had already passed.

## Findings fixed

- Replaced an undefined background token with the shared warm-white background token.
- Restored panel padding after introducing shared Card primitives.
- Removed empty KPI cards from Home and internal Inspect/Plan/Code/Test/Review steps from the agent summary. Build defaults to Preview.
- Replaced URL/port guessing with explicit desktop navigation callbacks.
- Added keyboard-search semantics and preserved accessible account naming in compact layouts.
- Skip-to-content focuses the current main surface instead of changing the desktop hash route to Home.
- Removed simulated outer window/background frame; Tauri owns its actual native window.

## Apple-style review

- Clarity: active navigation, page title/breadcrumb and connected/unavailable states identify location and status.
- Deference: conversation/document/preview occupies the largest work surface; Context can be hidden; website avoids application controls.
- Depth: persistent navigation, page content and supporting context have distinct but restrained levels.
- Consistency: shared color, spacing, type, radius and shadow tokens; Phosphor outline icons; supplied brand mark.

## Local draft follow-up

Chat and Work drafts were entered separately in an isolated preview tab. Both appeared on Home, reopened with the original text, and survived a reload. Removing the text removed each Home entry. Storage failure and malformed/oversized data have deterministic tests. Copy returned a success notice; browser CDP observed a blob download request with the expected file name and bytes, but the in-app browser did not emit a completed download event. Native desktop save behavior remains unverified. Test drafts were cleared after verification.

## Remaining limits

Current UI intentionally has service-disconnected empty states. Chat/Work drafts persist on this device and can be resumed after navigation or reload; they are not synced to an account. Complete keyboard/screen-reader certification, true macOS/Windows window interaction, and populated application states require their own follow-up acceptance. No public installer, recorded overview video, real AI response or persistent project exists yet. Local Docker infrastructure remains NOT VERIFIED by user choice.

final result: pass for the implemented interface scope, with the limits above; not full product acceptance.
