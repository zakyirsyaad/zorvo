# Chromium debug adapter

Optional advanced browser engine for the operations WebKit does not provide.
It opens an installed Chrome, Chromium or Brave in its own window and temporary
profile. The in-app page view remains WKWebView; this adapter does not claim to
inspect the same live WebKit document or share its cookies.

No CEF bundle or main-process entitlement is added. Regular CDP operations
use Chrome's inherited pipes (descriptors 3/4), with no debug TCP listener. The Rust caller
starts one worker per session through Zorvo's process wrapper, after the browser
grant, and owns its lifetime. Closing stdin or sending SIGTERM closes Chrome,
rejects pending protocol commands and removes the temporary profile/captures.

## Protocol

Run `node main.mjs` with trusted environment. The parent creates a dedicated
process group for the worker; on a hard timeout it signals that owned group,
so Chromium and audit descendants cannot outlive a force-killed worker.
Normal `shutdown`, EOF and SIGTERM perform graceful cleanup first:

`lighthouse-runner.mjs` loads the pinned CLI with inherited process groups,
overriding chrome-launcher's Unix detachment through the Node built-in spawn
boundary. Installed dependency files remain intact. Audit timeout/abort also
ends the recorded descendant tree before removing its temporary files.

- `ZORVO_BROWSER_ROOT`: the immutable canonical session workspace.
- `ZORVO_BROWSER_DATA`: private parent for the generated temporary directory.
- `ZORVO_BROWSER_CHROME`: optional installed executable; otherwise the adapter
  checks the usual Chrome, Brave and Chromium application paths.
- `ZORVO_LIGHTHOUSE_PATH`: installed pinned runtime's `lighthouse/cli/index.js`.

One JSON object per line:

```json
{"id":1,"sessionId":"session","args":{"engine":"chromium","operation":"tabs.open","url":"https://example.com/"}}
```

Replies echo the id and contain `result` or `error`. `catalog` returns all 45
initial operations and strict parameter schemas. The canonical parameter names
are `tabID`, `frameID`, `requestID`, `fileID`, `beforeID`, `afterID`, `objectID`;
the corresponding `Id` aliases are accepted. `tabs.open`, `tabs.list`,
`tabs.focus` and `tabs.close` include `tabs` and `activeTabId` state.

Tab refs are native DOM node identities scoped to the worker and cleared on
navigation. Internal element operations use an isolated content world. Explicit
`evaluate` runs in the page's world; its expression travels as protocol data
rather than being interpolated into an internal helper. Page console data and
network responses remain untrusted page output.

## File transfer

Browser access alone must not approve workspace uploads. The Rust caller strips
agent-supplied `approval`, calls private `upload.info` with `tabID`, `ref` and
`paths`, and shows the returned receiving origin/canonical files in the upload
permission card. Only after that grant may it attach `approval:{url,paths}` to
`files.upload`/`files.drop`. The worker reads the receiving frame from native DOM
metadata, rechecks the origin/files and stages bounded private copies. Changes
require a new permission. A consent token is never exposed as an agent tool.

Only canonical regular workspace files are read. Total staged bytes are capped
at 5 MiB per transfer, downloads/captures at 5 MiB each, 40 retained files per
session, 12 tabs, and 20 uploads. Network lists, headers, console and response
bodies have output limits; credential headers are omitted. Trace/CPU sampling
automatically stops after 30 seconds. Uncompressed recording data is capped at
36 MiB. The adapter denies capture, location, notifications and clipboard reads,
intercepts file choosers, and never attaches to an existing browser/profile.

## Lighthouse

The optional runtime's package and integrity lock live in `lighthouse-runtime/`.
Copy them into app data and run `npm ci --ignore-scripts` there. Lighthouse
13.6.0 requires Node 22.19 or newer; Zorvo's Node 26 satisfies that. Audits run
with the same installed browser in a fresh unauthenticated profile, so they do
not represent a logged-in tab's cookies or storage. The operation returns real
Lighthouse category scores and the retained report, or an explicit failure.
The Lighthouse CLI additionally starts its own short-lived Chrome through a
loopback-only DevTools port selected by chrome-launcher. This endpoint exists
only during an explicit audit and is closed with that audit's browser.

## Tests

```sh
node --test src-tauri/resources/browser-cdp/runtime.test.mjs
node src-tauri/resources/browser-cdp/smoke.mjs
ZORVO_LIGHTHOUSE_PATH='<runtime>/node_modules/lighthouse/cli/index.js' node src-tauri/resources/browser-cdp/smoke.mjs
```

The explicit smoke run starts a synthetic loopback server, a separate headless
Chrome profile and the actual worker; it tests navigation, accessibility refs,
inputs, dialogs, upload consent/drop, redacted network data, captures, trace,
CPU, heap and optionally the real Lighthouse CLI. No model/API request is made.
