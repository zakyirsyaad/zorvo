import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SignInLayer } from "../components/SignInLayer";
import type { AuthRequest } from "../hooks/useAgentAuth";
import type { useAgentSignIn } from "../hooks/useAgentSignIn";
import type { AgentProfile } from "../types";
import { fakeProfiles } from "./fixtures/agents";

const agent: AgentProfile = fakeProfiles[0];
const login = { id: "claude-ai-login", name: "Claude Subscription", kind: "terminal" as const };

function layerFor(request: AuthRequest | null, agentId: string | undefined = agent.id) {
  const signIn = {
    auth: { authRequest: request, requestSignIn: vi.fn(), signIn: vi.fn(), recheck: vi.fn(), dismiss: vi.fn() },
    cancel: vi.fn(),
    terminal: { dialog: null },
  } as unknown as ReturnType<typeof useAgentSignIn>;
  return <SignInLayer signIn={signIn} agents={fakeProfiles} agentId={agentId} />;
}

const request = (extra: Partial<AuthRequest> = {}): AuthRequest => ({
  profileId: agent.id,
  cwd: "/w",
  methods: [login],
  status: "idle",
  ...extra,
});

describe("the sign-in layer", () => {
  it("tells the user the returned message is sent again, only when a refused message was put back", () => {
    const { rerender } = render(layerFor(request()));
    expect(screen.queryByText("Your message will be sent again after you sign in.")).toBeNull();

    rerender(layerFor(request({ pending: { sessionId: "s1", text: "hello" } })));

    expect(screen.getByText("Your message will be sent again after you sign in.")).toBeInTheDocument();
  });

  it("announces the panel through a live region that was mounted before it", () => {
    const { rerender } = render(layerFor(null));
    const announcer = screen.getByRole("status");
    expect(announcer).toBeEmptyDOMElement();

    rerender(layerFor(request()));

    // The same element gets the text; the panel's own progress region is a second one.
    expect(screen.getAllByRole("status")[0]).toBe(announcer);
    expect(announcer).toHaveTextContent(`Sign-in needed. Pick how ${agent.name} signs in. It uses its own tool; Zorvo never sees your password or key.`);
    expect(screen.getByRole("region", { name: `Sign in to ${agent.name}` })).toBeInTheDocument();
  });

  it("announces nothing for another agent's request, which waits until its agent is shown", () => {
    render(layerFor(request(), "some-other-agent"));

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.queryByRole("region")).toBeNull();
  });
});
