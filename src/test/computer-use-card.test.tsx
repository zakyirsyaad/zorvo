import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ActionCard } from "../components/ActionCard";
import {
  COMPUTER_USE_ALLOW,
  COMPUTER_USE_DENY,
  allowedKeys,
  computerUseCard,
  parseComputerUseRequest,
  parseComputerUseState,
  settleComputerUseCard,
  usingLine,
} from "../lib/computer-use-card";
import type { ChatMessage } from "../types";

const PAYLOAD = {
  callId: "7",
  sessionId: "s-1",
  kind: "apps",
  reason: "Write the result in Notes.",
  apps: [
    { key: "app-1", name: "Notes", path: "/System/Applications/Notes.app", signer: "Apple", tier: "full", label: "Full use", warning: null, installed: true, icon: null },
    { key: "app-2", name: "Finder", path: "/System/Library/CoreServices/Finder.app", signer: "Apple", tier: "full", label: "Full use", warning: "Can open, move and delete your files.", installed: true, icon: null },
    { key: "app-3", name: "Terminal", path: "/System/Applications/Utilities/Terminal.app", signer: "Apple", tier: "click", label: "Click only", warning: null, installed: true, icon: null },
    { key: "app-4", name: "Zorvo", path: "/Applications/Zorvo.app", signer: "Team KY4XDK75RG", tier: "never", label: "Never allowed", warning: null, installed: true, icon: null },
    { key: "app-5", name: "com.example.missing", path: null, signer: null, tier: "never", label: "Not on this Mac", warning: null, installed: false, icon: null },
  ],
};

function card() {
  const event = parseComputerUseRequest(PAYLOAD);
  if (!event) throw new Error("the payload must parse");
  return computerUseCard(event, "Qwen Code", 1);
}

const tick = (name: string) => screen.getByRole("checkbox", { name });

describe("a computer-use request", () => {
  it("is dropped unless it is whole", () => {
    expect(parseComputerUseRequest({ ...PAYLOAD, apps: [] })).toBeNull();
    expect(parseComputerUseRequest({ ...PAYLOAD, kind: "full-screen" })).toBeNull();
    expect(parseComputerUseRequest({ ...PAYLOAD, apps: [{ key: "app-1", name: "Notes", tier: "root", label: "x" }] })).toBeNull();
    expect(parseComputerUseRequest(null)).toBeNull();
  });

  it("shows control and bidi characters in a name and the reason as text", () => {
    const event = parseComputerUseRequest({
      ...PAYLOAD,
      reason: "ok‮gnp.exe",
      apps: [{ ...PAYLOAD.apps[0], name: "Notes‮" }],
    });
    expect(event?.request.reason).not.toContain("‮");
    expect(event?.request.apps[0].name).not.toContain("‮");
  });

  it("keeps an icon only when it is a PNG data URL", () => {
    const withIcons = parseComputerUseRequest({
      ...PAYLOAD,
      apps: [
        { ...PAYLOAD.apps[0], icon: "data:image/png;base64,AAAA" },
        { ...PAYLOAD.apps[1], icon: "https://example.com/icon.png" },
      ],
    });
    expect(withIcons?.request.apps[0].icon).toBe("data:image/png;base64,AAAA");
    expect(withIcons?.request.apps[1].icon).toBeUndefined();
  });
});

describe("the computer-use card", () => {
  it("shows each row's label, signer, path and warning", () => {
    render(<ActionCard card={card()} agentName="Qwen Code" />);
    expect(screen.getByRole("heading", { name: "Qwen Code wants to use apps on your Mac" })).toBeInTheDocument();
    expect(screen.getByText("Write the result in Notes.")).toBeInTheDocument();
    const rows = within(screen.getByRole("list", { name: "Apps Qwen Code asks for" })).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(within(rows[1]).getByText("Full use")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Apple")).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("/System/Library/CoreServices/Finder.app");
    expect(within(rows[1]).getByText("Can open, move and delete your files.")).toBeInTheDocument();
    expect(tick("Finder")).toHaveAccessibleDescription("Can open, move and delete your files.");
    expect(within(rows[2]).getByText("Click only")).toBeInTheDocument();
    expect(screen.getByText("What Qwen Code sees in these apps goes to its model provider.")).toBeInTheDocument();
  });

  it("ticks what was asked, and leaves Zorvo and a missing app unticked and off", () => {
    render(<ActionCard card={card()} agentName="Qwen Code" />);
    expect(tick("Notes")).toBeChecked();
    expect(tick("Terminal")).toBeChecked();
    expect(tick("Zorvo")).not.toBeChecked();
    expect(tick("Zorvo")).toBeDisabled();
    expect(tick("com.example.missing")).toBeDisabled();
    expect(screen.getByText("Not on this Mac")).toBeInTheDocument();
    expect(tick("Notes")).toHaveClass("focus-ring");
  });

  it("sends only the ticked keys with Allow, and none with Deny", () => {
    const onChoose = vi.fn();
    render(<ActionCard card={card()} agentName="Qwen Code" onChoose={onChoose} />);
    fireEvent.click(tick("Finder"));
    fireEvent.click(screen.getByRole("button", { name: "Allow for this session" }));
    expect(onChoose).toHaveBeenCalledWith(COMPUTER_USE_ALLOW, { "app-1": "on", "app-3": "on" });
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onChoose).toHaveBeenLastCalledWith(COMPUTER_USE_DENY);
  });

  it("turns Allow off, with the reason, while nothing is ticked", () => {
    render(<ActionCard card={card()} agentName="Qwen Code" />);
    ["Notes", "Finder", "Terminal"].forEach((name) => fireEvent.click(tick(name)));
    const allow = screen.getByRole("button", { name: "Allow for this session" });
    expect(allow).toBeDisabled();
    expect(allow).toHaveAccessibleDescription("Tick at least one app to allow.");
  });

  it("never counts a key the user could not tick, whatever the answer says", () => {
    const answers = { "app-1": "on", "app-4": "on", "app-5": "on", "app-9": "on" };
    expect(allowedKeys(card(), answers)).toEqual(["app-1"]);
    expect(allowedKeys(card(), undefined)).toEqual([]);
  });

  it("reads Not answered, Denied, or what was allowed once settled, with no ticks or buttons", () => {
    const message = (): ChatMessage[] => [
      { id: "m-1", role: "agent", content: "", timestamp: 1, actionCard: card() } as ChatMessage,
    ];
    const settled = (outcome: Parameters<typeof settleComputerUseCard>[2]) =>
      settleComputerUseCard(message(), card().id, outcome)[0].actionCard!;

    const { rerender } = render(<ActionCard card={settled({ kind: "withdrawn" })} agentName="Qwen Code" />);
    expect(screen.getByText("Not answered")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(<ActionCard card={settled({ kind: "denied" })} agentName="Qwen Code" />);
    expect(screen.getByText("Denied")).toBeInTheDocument();

    rerender(<ActionCard card={settled({ kind: "allowed", keys: ["app-1", "app-3"] })} agentName="Qwen Code" />);
    expect(screen.getByText("Allowed for this session: Notes, Terminal")).toBeInTheDocument();
  });
});

describe("the computer-use state", () => {
  it("reads grants and waiting requests, and drops what is not whole", () => {
    const state = parseComputerUseState({
      grants: [
        { sessionId: "s-1", apps: [{ name: "Notes", tier: "full" }, { name: "Simulator", tier: "full" }], fullScreen: false },
        { apps: [] },
      ],
      requests: [PAYLOAD, { callId: "8" }],
    });
    expect(state.grants).toHaveLength(1);
    expect(usingLine(state.grants[0])).toBe("Using Notes, Simulator");
    expect(usingLine({ ...state.grants[0], fullScreen: true })).toBe("Controlling your screen");
    expect(state.requests).toHaveLength(1);
    expect(parseComputerUseState(null)).toEqual({ grants: [], requests: [] });
  });
});
