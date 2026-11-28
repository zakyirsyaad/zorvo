# Browser development

The Browser inspector uses the system WKWebView, outside Tauri's privileged
webview. It adds no bundled browser, helper app, main-process entitlement,
Node/CDP worker or browser-runtime installer. Chromium diagnostics are proposed
separately and require a maintainer decision before integration.

The standalone probe in #256 and capture guidance in #270 are merged. The
canonical engine note remains unchanged. Probe approval does not certify this
feature on older macOS or Intel; those runtime limits remain explicit.

## Ownership and permissions

Each session owns one non-persistent WebKit store, shared only by its own tabs.
Every tab has a separate configuration and isolated script world. The page has
no app initialization script or invoke key. Capture is disabled and denial
delegates replace permissive defaults before the first remote request.
Downloads are refused. JavaScript automatic windows remain disabled. The custom delegate additionally
admits only hyperlink navigation with a matching, short-lived trusted click
from its isolated world and current document. Navigation type alone also
accepts synthetic clicks, so it is not sufficient. Script window.open calls
are refused even if WebKit asks the delegate about them.
Permitted hyperlink popups stay in the background and never replace the active tab.
Page alerts complete silently; confirms return false and prompts return null.

`browser_commands.rs` reads the original authenticated pending tool call and
checks the backend's memory-only grant again at dispatch. Caller-provided
approval/authorization fields are removed. The first call waits on a normal
chat ActionCard with Allow for this session and Deny. `useAgentTools` owns the
single tool-call listener; its focused browser-card helper groups waiting
calls, withdraws ended requests and projects backend status for the session
menu. Popouts forward ordinary card choices to the main window. Stop allowing
browser access sits next to the delegation control in the session menu.

An agent exit revokes its grant and pending authorization without closing the
user's WebKit tabs. Login cookies and unfinished forms survive an agent crash
or End agent. Session deletion, startup orphan cleanup and app exit close the
views. Navigation/close cancel outgoing-document replies; a late WebKit
completion cannot answer them twice. Guarded termination/reset and close calls
release retained page state, with the legacy termination call as a fallback.
Behavior on other WebKit versions still requires runtime verification.

DOM operations wait for the document-start helper before dispatch. The wait
pins the original tab, checks authorization and tab lifetime, and shares the
operation's timeout. It runs outside the UI thread and never retries a click
or another interaction. A delayed-response fixture verifies an immediate wait
followed by exactly one click on the first document. A stalled-image fixture
also verifies that helper readiness does not wait for all network loading.

## Operations and page controls

The Rust catalog in `browser/catalog.json` exposes exactly these 19 operations:
`tabs.list`, `tabs.open`, `tabs.focus`, `tabs.close`, `navigate`, `back`,
`forward`, `reload`, `wait`, `snapshot`, `find`, `evaluate`, `screenshot`,
`click`, `fill`, `select`, `check`, `scroll` and `console`.

Network inspection, file transfer, drag, page dialogs, traces, CPU, heap and
Lighthouse are not included. Local HTML uses show_artifact and the existing
Output flow. Manual browser controls include stop loading, blank tabs, native
per-tab zoom, site information and recent pages. The compact tabs/address
layout is retained; Console and Debug live in their own tools menu.

Snapshots omit values of password inputs and autocomplete tokens naming a
password, one-time code or card data. Their type/ref remain usable for filling.
This protects the default snapshot read; explicit evaluate remains capable of
reading page data after a session grant. Open shadow roots are traversed,
closed roots remain opaque, and script-generated events are not trusted native
input. Sites may reject those events. Manual picking handles trusted main-frame
clicks and adds quoted context to the draft without sending it.

Native evaluate accepts an expression or async IIFE and awaits promises. Wrap
multiple statements in an IIFE with an explicit return. WebKit compiles the
caller code only in the page world; it never enters the isolated helper or
uses page eval. The legacy script alias executes a synchronous program and
returns its completion value. A failure is never retried with different syntax,
so side effects run once. Console/evaluate/DOM output remains page-controlled.

The address bar accepts explicit HTTP(S) addresses, domains and local servers.
Non-address text, including TODO: fix login, gets a local error and hint;
it is never sent to a search provider. The WebKit UA prefix is retained with
its Safari compatibility token and Zorvo identity before the first request.
No remote CSS, viewport metadata or zoom is rewritten to force responsiveness.

Site information reads real TLS properties, cookie counts and backend grant
status. Clearing is bound to the displayed URL and session; it clears applicable
cookies and origin storage, leaving shared HTTP cache alone. Overlapping menus
capture and decode one PNG before hiding the native view, then restore the
same view. There is no screenshot stream or per-scroll IPC.

Recent pages are a private, atomic, device-local list of at most 30 entries.
Known credential/signed-query URLs are excluded and fragments omitted. Clear
history preserves open pages, their navigation stacks and site data.

## Checks

Run pnpm lint, the affected Vitest files, then pnpm build. Rust changes require
cargo fmt --check, cargo clippy --all-targets -- -D warnings and cargo test from
src-tauri. The probe's Node suites remain separate and unchanged.

For real native integration, build a separate debug app with embedded assets:

```sh
pnpm tauri build --debug --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
node src-tauri/src/browser/smoke-fixture.mjs
```

Keep the synthetic loopback fixture running. Launch the generated app through
LaunchServices with its printed URL and a new output file per run:

```sh
open -W -n -a "$PWD/src-tauri/target/debug/bundle/macos/Zorvo.app" \
  --env ZORVO_BROWSER_SMOKE_URL=http://127.0.0.1:PORT/ \
  --env ZORVO_BROWSER_SMOKE_OUTPUT=/tmp/zorvo-native-result.json \
  --env ZORVO_BROWSER_SMOKE_CASE=full
```

The opt-in harness waits for frontend startup cleanup, closes its test sessions
and exits within a 120-second overall deadline. Cases are full, responsive,
chrome (manual browser controls, not Chromium), forms, lifecycle, placement and
sites. Forms bundle actual installed React in memory with no CDN. Lifecycle
checks five retained tabs, native bounds/visibility, nested scrolling, grant
revocation retention, session teardown, looping JavaScript and owned process
exit. Placement alternates actual artifact/browser child views through a PNG
menu-cover cycle. Sites checks public HTTPS snapshots/TLS/layout and records
public HTTP as loaded or blocked/unavailable under the unchanged ATS policy.

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
  upload is armed for an origin other than the page's. A click with nothing armed opens the system
  open panel (found among the app's windows, shown for 1.5 s, then cancelled), and cancelling it
  leaves the input as it was.
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

Current integration runs use macOS 27.0.1 on Apple Silicon. Capture-denial runs
below macOS 27, Intel runtime behavior, sustained full-app resource cost and
trackpad parity remain unverified. A review-ready feature is not a certification
of every supported runtime.
