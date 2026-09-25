# AYRA desktop frontend design QA — 2026-09-25

## Scope

This review covers the desktop frontend update on the ZA-AYRA branch. The visual targets are the user-provided AYRA0.png through AYRA3.png screenshots. They are approximate layout and visual references, while the AYRA baseline and later website/desktop design specification govern product boundaries. The marketing website remains a separate download-oriented product.

## Captures and comparison

The four reference images at `/Users/mac/Downloads/AYRA0.png` through `/Users/mac/Downloads/AYRA3.png` were inspected. The updated Home, Chat, Work, Build, and Projects surfaces were captured and visually inspected in Codex In-app Browser tab 3 at `http://127.0.0.1:1420/` at the normal desktop viewport. Browser screenshots were inspected in the tool; they were not exported as repository assets. The latest screen was captured after implementation, not inferred from the source code.

Home follows the reference's wide editorial hero, four quiet metrics, Continue Working, Projects, and right focus/activity rail. Chat follows its conversation/context split. Work follows the outline/document/source split. Build follows its repository/code/agent layout with tests, diff, and preview. Projects provides a focused list/detail workspace. The supplied logo and mountain image remain in use; the fictional sample avatar was generated for this layout. Spacing, typography, radii, icon weight, and pastel accents are consistent across surfaces.

## Interaction checks

- Navigation between Home, Chat, Work, Build, Projects, and Activity showed the expected surface.
- Chat sample source notes expand; Work outline and context tabs change; Build tabs and selected file content change; Projects list selection changes its details; Activity filters show matching rows.
- The workspace menu switches between clearly labeled illustrative sample content and the real personal workspace. The selection survived a reload.
- The personal Projects creation form opened and cancelled without creating test data. Local project serialization, malformed-data handling, and storage-failure behavior have deterministic tests. Project creation remains device-only and is labeled as such.
- The Projects frontend flow was exercised at an isolated `127.0.0.1:1421` test origin: create two local projects, add and complete a task, reload to confirm persistence, then select the older project from Home and verify its details remained selected after navigation. This test data did not touch the user's `127.0.0.1:1420` preview origin.
- The browser console had no errors or warnings during the inspected sample interactions. The Vite preview was restarted after adding a package export and the browser was reloaded successfully.

## Apple-style review

Clarity: each surface has one primary center, navigation state, and a visible next action. Deference: content occupies the main width; supporting context stays in side rails. Depth: sidebar, primary canvas, and context have restrained hierarchy. Consistency: the same warm-white surfaces, soft borders, Phosphor icons, and editorial titles appear across the app.

## Remaining limits

The sample workspace is explicitly illustrative and contains no real account, model response, verified research data, repository, or running tests. Personal Chat notes, Work drafts, and Projects are local frontend features. Account sync, real AI execution, native installer release, macOS/Windows end-to-end verification of this revision, and backend services remain unfinished. The user requested frontend work before backend implementation. Docker infrastructure remains unverified by the user's stated choice.

final result: passed
