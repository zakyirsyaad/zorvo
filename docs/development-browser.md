# Browser development

The native Browser inspector uses system WebKit. Chromium debug uses an installed
Chrome, Brave or Chromium in a separate temporary profile and window. It does not
inspect the same document as the WebKit panel. No CEF runtime, helper apps or new
main-process entitlements are bundled.

The standalone probe in PR #256 and canonical capture guidance in PR #270 are
merged. The full browser integration is submitted separately for review. The
engine note and probe remain the record of accepted direction and standalone
observations; they do not certify older OS or Intel runtime behavior of this
integration. Current-Mac integration observations are recorded below.

## Entry points

- `src-tauri/src/browser/`: main-thread native views, per-session non-persistent
  stores, guarded capture policy, named script world, document-scoped refs and
  bounded operations. Every tab has its own configuration and shares only its
  session's data store. Navigation accepts HTTP(S), with credentials and external
  schemes refused. Script events are untrusted events; some sites ignore them.
- `browser_commands.rs`: authenticated pending agent calls, session browser
  grants, one-time file receipts and manual UI actions. The original request is
  read from the backend's pending table; agent-supplied approvals are discarded.
  The request and grant generation are checked again at engine dispatch.
- `browser_debug.rs` and `resources/browser-cdp/`: JSONL process supervision and
  the 45-operation Chromium adapter. A worker has its own process group. Close,
  cancellation deadlines and app exit end its owned processes. The optional
  Lighthouse installation has an exact version and npm integrity lockfile; only
  an explicit install click downloads it. Audits use a fresh profile and a
  temporary loopback endpoint; regular diagnostics use a CDP pipe.
- `useBrowser*` and `components/browser/`: normal Inspector tab, retained view
  placement, overlay hiding, address normalization, tools and permission dialogs.
  Navigation from UI never starts an ACP agent or a loopback HTTP server. Address
  search submits to Google. The compact toolbar shows navigation, the address,
  element selection and its menu. A closable tab strip and blank new-tab action
  sit above it. The page menu offers zoom, copy link, open in the system browser
  and Clear history; the separate tools menu contains engine choices, diagnostic
  views and browser-access revocation. The main Tauri CSP remains unchanged.

Native page zoom uses WebKit's public page-zoom API and stays with its tab. Its
percentage in the address field resets to 100%. These controls are manual UI
commands, separate from the agent operation catalog. Chromium debug uses its
external window's own zoom controls.

Recent native pages are a device-local, deduplicated list of at most 30 entries
in a private `browser-visits.json` file. Known credential-query URLs are excluded
and fragments are omitted. Blank tabs show these visits as links. Clear history
empties that list; open tabs, their back/forward stacks and site data are kept.
Older browser-history files are not imported or changed.

The native browser preserves WebKit's user-agent prefix and appends the standard
`Safari/605.1.15` compatibility token plus `Zorvo/<version>` before its first
request. Raw WKWebView identification makes some sites serve a fixed-width
fallback. This identifies the actual WebKit engine without borrowing a Chromium
identity or inventing a Safari application version. The retained view still uses
the panel's logical bounds; no page CSS, viewport meta tag or zoom is overridden.

Site information reads the current native view's TLS properties and its session's
cookie store; cookie names and values never cross IPC. Clear is a manual action
bound to the displayed URL. It removes cookies applicable to the host on all
paths (including shared parent-domain cookies), and clears that origin's local
and session storage, IndexedDB, CacheStorage and service-worker registrations.
Blocked deletion reports a partial result. Shared HTTP network caches are left
alone because WebKit's grouped data records can include other hosts. Agent access
reflects the existing session grant; the information panel grants no permissions.

An overlapping browser menu captures one native PNG and decodes it before hiding
the view beneath the HTML panel. Closing the menu restores the retained native
view and releases that still image. No capture loop or per-scroll IPC is used.

The manual element picker uses the fixed named-world helper, with no messages on
hover or scroll. A trusted main-frame click returns bounded, quoted page context
to the composer without sending a message. Its native view, document token and
arm nonce are checked before accepting the selection. Cancellation is bound to
the requesting UI's ID, so a late cleanup cannot cancel a replacement picker.
Navigation, leaving the page and Escape cancel selection. Iframe selection is
not currently supported by this manual picker.

## Operation groups

Both engines support tabs/navigation, frames, wait, snapshot, find, evaluate,
screenshot, click, hover, drag, fill, forms, select, check, key, scroll, dialogs and
console. WebKit reads a bounded control snapshot and DOM text; it does not claim
to expose closed shadow roots or trusted native input. Chromium adds full request
inspection, approved workspace files, performance traces, CPU and heap operations,
and Lighthouse. `browser_guide` returns the operation names and parameter schemas.
Unsupported engine operations fail explicitly. Debug, Network, Console, Files
and Performance views opened from the browser menu show actual operation results.

Local HTML preview uses the existing artifact store and Review/Output flow.
The Chromium adapter also has a bounded workspace image/text/PDF preview. Downloads
and page device permissions are denied. Console and explicit evaluate output
remain page-controlled data.

Native `evaluate` accepts a JavaScript expression, including an async IIFE, and
awaits its promise. Wrap multiple statements in an IIFE with an explicit return.
WebKit compiles this caller code only in the page world; it never enters the
isolated helper or uses page `eval`, which strict site CSPs can block. The legacy
`script` alias executes a synchronous program through WebKit and returns its
completion value. A failed operation is never retried as a different syntax:
side effects execute once. Console reads use the same native expression path.

Navigating or closing a document cancels its outstanding operation replies.
Late WebKit completions cannot replace those cancellations. A pending page
dialog is dismissed before explicit navigate, reload, back or forward, since
the dialog can prevent WebKit from starting the replacement document.
Closing a view uses guarded WebKit termination/reset and close selectors. The
reset clears process state in addition to requesting termination; the older
termination selector remains a fallback where reset is unavailable. The debug
lifecycle case checks actual owned process exit on the tested OS. Availability
and termination behavior on other WebKit versions remain runtime checks.

## Checks

```sh
pnpm lint
pnpm vitest run src/test/browser.test.ts src/test/browser-panel.test.tsx src/test/browser-picker.test.tsx src/test/browser-agent-tools.test.tsx
node --test src-tauri/resources/browser-cdp/runtime.test.mjs
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

The explicit Chromium smoke command is documented in its README. It exercises
the real installed browser, all operation families and optionally pinned
Lighthouse against a synthetic loopback fixture; it uses no model API.

Build a separate debug application with embedded frontend assets:

```sh
pnpm tauri build --debug --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
node src-tauri/src/browser/smoke-fixture.mjs
```

Keep the fixture running, then launch the generated app through LaunchServices,
using the printed loopback URL. Use a new output file for each run:

```sh
open -W -n -a "$PWD/src-tauri/target/debug/bundle/macos/Zorvo.app" \
  --env ZORVO_BROWSER_SMOKE_URL=http://127.0.0.1:PORT/ \
  --env ZORVO_BROWSER_SMOKE_OUTPUT=/tmp/zorvo-native-result.json \
  --env ZORVO_BROWSER_SMOKE_CASE=full
```

The opt-in debug harness waits for frontend startup cleanup, closes its own
test sessions and exits, with a 120-second overall deadline. It covers native
snapshots, form events, hidden interaction, cross-origin frame access, session
cookie isolation, stale same-document refs, alert/confirm/prompt accept/dismiss,
and navigation or tab close while a dialog is pending. Navigation waits observe
a new document identity and exact URL, rather than a selector in the old page.
A successful synthetic smoke is not evidence of trackpad parity with OpenCode,
the full real-site matrix or older-OS behavior. Debug state uses its own app data
directory; the installed release app and its sessions need not be replaced.

Set `ZORVO_BROWSER_SMOKE_CASE=responsive` for the focused first-request identity
and viewport check. It resizes one retained native view to 360, 560 and 900 logical
pixels and checks that the page reflows without horizontal overflow, navigation
or lost form state.

Set `ZORVO_BROWSER_SMOKE_CASE=chrome` to exercise native blank tabs and per-tab
zoom/reset while checking that form state survives and another tab stays at 100%.

Additional explicit cases:

- `upload`: the ref check tells a file input from a button; an agent upload armed on a tab answers
  the page's own file chooser after the helper clicks the input and reads `taken` (the page reads
  back both files' names and contents); a click that opens no chooser reads `waiting`, then
  `expired` once the arm's lifetime ends, never `taken`; withdrawing needs no call grant; and no
  upload is armed for an origin other than the page's. The system open panel for a person's own
  click is not driven here.
- `forms`: nested open-shadow refs, a strict-CSP page, awaited expressions,
  exactly-once runtime errors, the legacy script alias, and an actual React
  controlled long form. React is bundled from the checkout into an in-memory
  local fixture; no CDN or production assets are used.
- `lifecycle`: five retained tabs across three focus/resize/hide cycles,
  nested scrolling, sibling-tab preservation, fresh state after session close,
  and closing a page running an infinite JavaScript loop. Native view bounds
  and visibility are read directly. Owned WebContent process identities and
  deduplicated RSS samples are observations; they are not a leak guarantee.
- `placement`: actual artifact and browser child views alternate at three
  widths, with native visibility/bounds and browser document/input retention
  checked through a one-shot PNG menu-cover cycle. This does not exercise a
  user's composer focus or every popup/window arrangement.
- `sites`: explicit public navigation to HTTPS example.com, GitHub and MDN,
  recording native TLS, snapshots, isolation and layout at three widths. It
  also records HTTP example.com as loaded or blocked/unavailable under the
  existing ATS policy. No certificate exception or ATS relaxation is added.

The [2026-11-21 integration record](testing/browser-integration-2026-11-21.json)
contains source digests and bounded observations: five complete native runs,
two lifecycle runs, controlled React/strict-CSP forms, native artifact placement,
public HTTPS sites, and Chromium diagnostics including pinned Lighthouse.
The lifecycle runs observed all eight owned WebContent processes end after
cleanup; they do not establish sustained leak-free behavior. Public HTTP was
blocked or unavailable under the unchanged ATS policy.

Current integration runs use macOS 27.0.1 on Apple Silicon. Capture-denial runs
below macOS 27, Intel runtime behavior, sustained full-app resource cost and
trackpad parity remain unverified. The original engine gate matrix continues
to state those requirements; a review-ready feature is not a certification of
every supported runtime.
