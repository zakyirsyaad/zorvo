// Throwaway spike for the design canvas: three questions, one JSON report on stdout.
// 1. Does Zorvo's script run, and can it post, inside sandboxed iframes served from a
//    custom scheme, with the frame's own URL attached? Do folder assets load there?
// 2. Can an artboard be snapshotted to PNG at full size, and printed to PDF, by a
//    WKWebView that is not in any visible window?
// 3. How smooth is pan and zoom over 40 artboards: all live, or 8 live and the rest images?
import AppKit
import WebKit
import Darwin

let SCHEME = "zorvo-artifact"
let SHELL_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
  + "img-src zorvo-artifact://localhost data: blob:; frame-src zorvo-artifact://localhost; "
  + "connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts"
let BOARD_CSP = "default-src 'none'; script-src 'unsafe-inline'; "
  + "style-src 'unsafe-inline' zorvo-artifact://localhost; img-src zorvo-artifact://localhost data: blob:; "
  + "connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; "
  + "sandbox allow-scripts"

var report: [String: Any] = [:]
func log(_ s: String) { FileHandle.standardError.write(Data(("[spike] " + s + "\n").utf8)) }
func dump() {
  if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
    try? data.write(to: URL(fileURLWithPath: CommandLine.arguments[1] + "/partial.json")) }
}
func finish() {
  let data = try! JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
  print(String(data: data, encoding: .utf8)!)
  exit(0)
}

// A 4x4 red PNG, the "asset in the canvas folder".
let dotPNG = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8AARwzE8DkAAP5PBf9zBbKmAAAAAElFTkSuQmCC")!

func board(_ n: Int, height: Int = 900) -> String {
  """
  <!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="board.css">
  <style>body{margin:0;font:16px -apple-system;background:linear-gradient(135deg,hsl(\(n * 37 % 360),70%,92%),#fff);height:\(height)px}
  h1{margin:0;padding:40px;font-size:48px}.card{margin:20px 40px;padding:24px;border-radius:16px;background:#fff;box-shadow:0 8px 24px #0002}
  button{padding:12px 20px;border-radius:10px;border:0;background:#333;color:#fff}</style></head>
  <body><h1>Artboard \(n)</h1><div class="card">Pricing card <button id="buy">Buy</button> <img id="dot" src="dot.png" width="16" height="16"></div>
  <canvas id="c" width="600" height="200" style="margin:0 40px"></canvas>
  <script>
  const ctx=document.getElementById('c').getContext('2d');let t=0;
  function draw(){ctx.clearRect(0,0,600,200);ctx.fillStyle='hsl(\(n * 37 % 360),60%,50%)';
  for(let i=0;i<20;i++){ctx.fillRect(i*30,200-80-60*Math.sin((i+t)/3),20,80+60*Math.sin((i+t)/3))}t+=0.2;requestAnimationFrame(draw)}draw();
  </script></body></html>
  """
}

func shell(count: Int, budget: Int) -> String {
  """
  <!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;overflow:hidden;background:#ececec}
  #world{position:absolute;left:0;top:0;transform-origin:0 0}
  .ab{position:absolute;width:1440px;height:900px;background:#fff;box-shadow:0 2px 8px #0003}
  .ab iframe{border:0;width:1440px;height:900px;display:block}
  .ab .ph{width:1440px;height:900px;background:#dcdcdc}
  </style></head><body><div id="world"></div><script>
  const COUNT=\(count), BUDGET=\(budget), COLS=8, W=1440, H=900, GAP=200;
  const world=document.getElementById('world'); const boards=[];
  for(let i=0;i<COUNT;i++){const d=document.createElement('div');d.className='ab';
    d.style.left=(i%COLS)*(W+GAP)+'px';d.style.top=Math.floor(i/COLS)*(H+GAP)+'px';
    world.appendChild(d);boards.push({el:d,live:false,i});}
  let view={x:0,y:0,z:0.15};
  function apply(){world.style.transform=`translate(${-view.x*view.z}px,${-view.y*view.z}px) scale(${view.z})`;mount();}
  function visible(b){const r=b.el.getBoundingClientRect();return r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;}
  function setLive(b,live){if(b.live===live)return;b.live=live;b.el.textContent='';
    if(live){const f=document.createElement('iframe');f.setAttribute('sandbox','allow-scripts');
      f.src='zorvo-artifact://localhost/a/'+b.i+'/index.html';b.el.appendChild(f);}
    else{const p=document.createElement('div');p.className='ph';b.el.appendChild(p);}}
  function mount(){const vis=boards.filter(visible);
    vis.sort((a,b)=>{const ra=a.el.getBoundingClientRect(),rb=b.el.getBoundingClientRect();
      const cx=innerWidth/2,cy=innerHeight/2;return Math.hypot(ra.x+ra.width/2-cx,ra.y+ra.height/2-cy)-Math.hypot(rb.x+rb.width/2-cx,rb.y+rb.height/2-cy)});
    const keep=new Set(vis.slice(0,BUDGET));for(const b of boards)setLive(b,keep.has(b));}
  window.__run=function(){return new Promise(res=>{const frames=[];let last=performance.now();const start=last;
    function step(now){frames.push(now-last);last=now;const t=(now-start)/5000;
      view.z=0.12+0.5*Math.abs(Math.sin(t*Math.PI));view.x=t*6000;view.y=Math.sin(t*6)*1500+1500;apply();
      if(now-start<5000)requestAnimationFrame(step);else{const s=frames.slice(1).sort((a,b)=>a-b);
        const live=boards.filter(b=>b.live).length;
        res(JSON.stringify({frames:s.length,medianMs:s[Math.floor(s.length/2)],p95Ms:s[Math.floor(s.length*0.95)],
          maxMs:s[s.length-1],over33ms:s.filter(x=>x>33.4).length,liveAtEnd:live}));}}
    requestAnimationFrame(step);});};
  apply();
  </script></body></html>
  """
}

final class Scheme: NSObject, WKURLSchemeHandler {
  var requests: [String] = []
  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    let url = task.request.url!
    requests.append(url.absoluteString); log("scheme \(url.absoluteString)")
    var body = Data(); var type = "text/html"; var csp = BOARD_CSP
    let parts = url.path.split(separator: "/").map(String.init)
    if parts.first == "shell" {
      let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
      let count = Int(q.first { $0.name == "count" }?.value ?? "4") ?? 4
      let budget = Int(q.first { $0.name == "budget" }?.value ?? "99") ?? 99
      body = Data(shell(count: count, budget: budget).utf8); csp = SHELL_CSP
    } else if parts.last == "dot.png" { body = dotPNG; type = "image/png" }
    else if parts.last == "board.css" { body = Data("h1{letter-spacing:-1px}".utf8); type = "text/css" }
    else if parts.first == "a", parts.count >= 2, let n = Int(parts[1]) {
      body = Data(board(n, height: parts.last == "tall.html" ? 3000 : 900).utf8)
    }
    let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
      headerFields: ["Content-Type": type, "Content-Security-Policy": csp, "Cache-Control": "no-store"])!
    task.didReceive(response); task.didReceive(body); task.didFinish()
  }
  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class Messages: NSObject, WKScriptMessageHandler {
  var received: [[String: Any]] = []
  var frames: [String: WKFrameInfo] = [:]
  func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
    let url = m.frameInfo.request.url?.absoluteString ?? "?"
    frames[url] = m.frameInfo
    received.append(["frameURL": url, "isMainFrame": m.frameInfo.isMainFrame,
      "origin": "\(m.frameInfo.securityOrigin.protocol)://\(m.frameInfo.securityOrigin.host)",
      "body": m.body as? String ?? "?"])
  }
}

final class Nav: NSObject, WKNavigationDelegate {
  var decided: [[String: Any]] = []
  var onFinish: (() -> Void)?
  func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    let url = a.request.url?.absoluteString ?? ""
    let ok = url.hasPrefix(SCHEME + "://localhost/")
    decided.append(["url": url, "mainFrame": a.targetFrame?.isMainFrame ?? false, "allowed": ok])
    decisionHandler(ok ? .allow : .cancel)
  }
  func webView(_ w: WKWebView, didFinish n: WKNavigation!) { onFinish?() }
  func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { log("didFail \(e)"); onFinish?() }
  func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { log("didFailProvisional \(e)"); onFinish?() }
}

// Zorvo's own script: runs in every frame, reports the frame, the folder asset, clicks, and
// whether it can reach the parent document (it must not).
let ZORVO_SCRIPT = """
(function(){
  const post=(o)=>window.webkit.messageHandlers.zorvo.postMessage(JSON.stringify(o));
  window.addEventListener('load',()=>{
    const img=document.getElementById('dot');
    let parentReadable=false;try{parentReadable=!!window.parent.document}catch(e){}
    post({kind:'hello',top:window===window.top,asset:img?(img.naturalWidth===4?'loaded':'missing:'+img.naturalWidth):'none',
      css:getComputedStyle(document.querySelector('h1')||document.body).letterSpacing,parentReadable});
  });
  document.addEventListener('click',(e)=>{post({kind:'pick',tag:e.target.tagName,id:e.target.id});e.preventDefault();e.stopPropagation();},true);
  window.addEventListener('message',(e)=>{if(e.source===window.parent&&e.data&&e.data.zorvo==='mode')post({kind:'mode',on:e.data.on});});
})();
"""

@MainActor func makeView(_ frame: NSRect, scheme: Scheme, messages: Messages?) -> WKWebView {
  let config = WKWebViewConfiguration()
  config.websiteDataStore = .nonPersistent()
  config.setURLSchemeHandler(scheme, forURLScheme: SCHEME)
  if let messages {
    config.userContentController.add(messages, name: "zorvo")
    config.userContentController.addUserScript(WKUserScript(source: ZORVO_SCRIPT, injectionTime: .atDocumentStart, forMainFrameOnly: false))
  }
  return WKWebView(frame: frame, configuration: config)
}

func wait(_ seconds: Double) async { try? await Task.sleep(nanoseconds: UInt64(seconds * 1e9)) }

@MainActor func load(_ view: WKWebView, _ nav: Nav, _ path: String) async {
  await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
    var done = false
    nav.onFinish = { if !done { done = true; c.resume() } }
    view.navigationDelegate = nav
    view.load(URLRequest(url: URL(string: "\(SCHEME)://localhost/\(path)")!))
    DispatchQueue.main.asyncAfter(deadline: .now() + 10) { if !done { done = true; log("load timeout \(path)"); c.resume() } }
  }
}

@MainActor func nonBlankRatio(_ image: NSImage) -> (Int, Int, Double) {
  guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return (0, 0, 0) }
  let rep = NSBitmapImageRep(cgImage: cg)
  var colored = 0, total = 0
  for x in stride(from: 0, to: cg.width, by: 37) { for y in stride(from: 0, to: cg.height, by: 37) {
    total += 1
    if let c = rep.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB), c.redComponent < 0.97 || c.greenComponent < 0.97 || c.blueComponent < 0.97 { colored += 1 }
  } }
  return (cg.width, cg.height, Double(colored) / Double(max(total, 1)))
}

@MainActor func spikeFrames(window: NSWindow) async {
  let scheme = Scheme(); let messages = Messages(); let nav = Nav()
  let mode = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "full"
  let view = makeView(window.contentView!.bounds, scheme: scheme, messages: mode.contains("nomsg") ? nil : messages)
  window.contentView!.addSubview(view)
  log("load shell \(mode)"); await load(view, nav, mode.contains("board") ? "a/1/index.html" : "shell?count=4&budget=4")
  log("loaded shell"); await wait(2.0)
  log("messages so far \(messages.received.count)")
  // A click inside an artboard, sent into that frame only (Zorvo's way to reach one artboard).
  var clicked: Any = "no frame"
  if let (_, frame) = messages.frames.first(where: { !$0.value.isMainFrame }) {
    log("eval in frame")
    view.evaluateJavaScript("document.getElementById('buy').click(); 'ok'", in: frame, in: .page) { r in
      switch r { case .success(let v): clicked = "\(v)"; case .failure(let e): clicked = "error: \(e)" }
      log("eval in frame done")
    }
    await wait(1.0)
  }
  // A message from the shell to every artboard (the relay path for comment mode).
  log("relay"); view.evaluateJavaScript("for(const f of document.querySelectorAll('iframe'))f.contentWindow.postMessage({zorvo:'mode',on:true},'*');1") { _, _ in }
  await wait(0.8)
  // A frame trying to leave: the navigation handler must see it.
  if let (_, frame) = messages.frames.first(where: { !$0.value.isMainFrame }) {
    log("leave"); view.evaluateJavaScript("location.href='https://example.com/'; 1", in: frame, in: .page) { _ in }
  }
  await wait(0.8)
  defer { dump() }
  report["spike1"] = ["messages": messages.received, "evaluateInFrame": clicked,
    "navigations": nav.decided, "schemeRequests": scheme.requests.count]
  view.removeFromSuperview()
}

@MainActor func spikeSnapshot() async {
  var results: [[String: Any]] = []
  for (label, inWindow) in [("noWindow", false), ("offscreenWindow", true)] {
    for (path, h) in [("a/3/index.html", 900), ("a/5/tall.html", 3000)] {
      let scheme = Scheme(); let nav = Nav()
      let view = makeView(NSRect(x: 0, y: 0, width: 1440, height: h), scheme: scheme, messages: nil)
      var hidden: NSWindow?
      if inWindow {
        hidden = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: 1440, height: h), styleMask: [.borderless], backing: .buffered, defer: false)
        hidden!.contentView = view; hidden!.orderBack(nil)
      }
      let started = ProcessInfo.processInfo.systemUptime
      log("snapshot \(label) \(h)")
      await load(view, nav, path)
      await wait(0.4)
      let config = WKSnapshotConfiguration(); config.rect = NSRect(x: 0, y: 0, width: 1440, height: h); config.afterScreenUpdates = true
      var entry: [String: Any] = ["mode": label, "page": path]
      do {
        log("takeSnapshot"); let image = try await view.takeSnapshot(configuration: config); log("got image")
        let (w, hh, ratio) = nonBlankRatio(image)
        entry["png"] = ["width": w, "height": hh, "coloredRatio": ratio, "ms": (ProcessInfo.processInfo.systemUptime - started) * 1000]
        if let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) {
          try? NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])?
            .write(to: URL(fileURLWithPath: CommandLine.arguments[1] + "/\(label)-\(h).png"))
        }
      } catch { entry["png"] = ["error": "\(error)"] }
      do {
        let pdfConfig = WKPDFConfiguration(); pdfConfig.rect = NSRect(x: 0, y: 0, width: 1440, height: h)
        log("pdf"); let pdf = try await view.pdf(configuration: pdfConfig); log("got pdf")
        try pdf.write(to: URL(fileURLWithPath: CommandLine.arguments[1] + "/\(label)-\(h).pdf"))
        let doc = NSPDFImageRep(data: pdf)
        entry["pdf"] = ["bytes": pdf.count, "pages": doc?.pageCount ?? 0, "width": doc?.bounds.width ?? 0, "height": doc?.bounds.height ?? 0]
      } catch { entry["pdf"] = ["error": "\(error)"] }
      results.append(entry)
      hidden?.orderOut(nil)
    }
  }
  report["spike2"] = results; dump()
}

@MainActor func spikePan(window: NSWindow) async {
  var runs: [String: Any] = [:]
  for (label, budget) in [("all40Live", 40), ("budget8", 8)] {
    let scheme = Scheme(); let nav = Nav()
    let view = makeView(window.contentView!.bounds, scheme: scheme, messages: nil)
    window.contentView!.addSubview(view)
    log("pan \(label)"); await load(view, nav, "shell?count=40&budget=\(budget)")
    await wait(3.0)
    let vis = try? await view.evaluateJavaScript("document.visibilityState + ' ' + document.hasFocus()")
    log("visibility \(String(describing: vis)) active \(NSApp.isActive) key \(window.isKeyWindow)")
    var result: Any? = nil; var got = false
    view.callAsyncJavaScript("return await window.__run()", arguments: [:], in: nil, in: .page) { r in
      got = true
      switch r { case .success(let v): result = v; case .failure(let e): result = "error: \(e)" } }
    for _ in 0..<40 where !got { await wait(0.5) }
    if !got { result = "timeout" }
    runs[label] = (result as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } ?? String(describing: result)
    var rss = 0
    let sel = NSSelectorFromString("_webProcessIdentifier")
    if view.responds(to: sel) {
      typealias GetPID = @convention(c) (AnyObject, Selector) -> Int32
      let pid = unsafeBitCast(view.method(for: sel), to: GetPID.self)(view, sel)
      var info = proc_taskinfo()
      if proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &info, Int32(MemoryLayout.size(ofValue: info))) > 0 { rss = Int(info.pti_resident_size) / 1024 }
    }
    runs[label + "WebContentMaxRssMB"] = rss / 1024; report["spike3"] = runs; dump()
    view.removeFromSuperview()
    await wait(1.0)
  }
  report["spike3"] = runs
}

final class Delegate: NSObject, NSApplicationDelegate {
  var window: NSWindow!
  func applicationDidFinishLaunching(_ n: Notification) {
    window = NSWindow(contentRect: NSRect(x: 120, y: 120, width: 1280, height: 800), styleMask: [.titled], backing: .buffered, defer: false)
    window.title = "Zorvo canvas spike (closes by itself)"
    window.level = .floating
    window.orderFrontRegardless()
    NSApp.activate(ignoringOtherApps: true)
    let window = self.window!
    Task { @MainActor in
      if !CommandLine.arguments.contains("pan") { log("frames"); await spikeFrames(window: window)
      log("snapshot"); await spikeSnapshot() }
      log("pan"); await spikePan(window: window)
      report["screen"] = ["backingScale": window.backingScaleFactor]
      log("done"); finish()
    }
  }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = Delegate()
app.delegate = delegate
app.run()
