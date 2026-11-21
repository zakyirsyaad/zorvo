# Design canvas spike (throwaway)

The probe behind the "Spike results" of `../2026-11-21-design-canvas-design.md`.
It is kept for the record and is not built, tested or shipped.

Build it into an app bundle (`Info.plist` with a bundle identifier) and launch
it with `open -W -n --stdout out.json --stderr err.txt Probe.app --args <dir> [pan]`:
WebKit cannot start its content process from a bare executable or one a
shell starts. Its window floats above other windows for about 20 seconds.

    swiftc -O -target arm64-apple-macosx12.0 -swift-version 5 Probe.swift \
      -o Probe.app/Contents/MacOS/probe -framework AppKit -framework WebKit
