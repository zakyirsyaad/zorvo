import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { createPortal } from "react-dom";
import "@testing-library/jest-dom/vitest";
import { OptionDropdown, type DropdownOption } from "../components/composer/OptionDropdown";
import { ComposerDock } from "../components/ComposerDock";

const marksIn = (element: Element) => [...element.querySelectorAll("mark")].map((mark) => mark.textContent);

function openModelMenu(options: DropdownOption[], query: string) {
  render(
    <OptionDropdown label="Model" icon={null} options={options} selected={options[0].value} isOpen onToggle={() => {}} onSelect={() => {}} />,
  );
  fireEvent.change(screen.getByRole("searchbox", { name: "Search model" }), { target: { value: query } });
}

describe("search highlights in the model menu", () => {
  const filler: DropdownOption[] = Array.from({ length: 10 }, (_, i) => ({ value: `f${i}`, label: `filler ${i}` }));

  it("highlights a query that crosses the provider tag", () => {
    openModelMenu([{ value: "k", label: "[OpenRouter] kimi-k2" }, { value: "g", label: "[OpenRouter] glm-4" }, ...filler], "router] ki");

    const group = screen.getByRole("group", { name: "OpenRouter" });
    const heading = group.querySelector("[id]")!;
    expect(marksIn(heading)).toEqual(["Router"]);
    expect(marksIn(within(group).getByRole("option", { name: /kimi-k2/ }))).toEqual(["ki"]);
    expect(within(group).queryByRole("option", { name: /glm-4/ })).toBeNull();
  });

  it("highlights a match found only in the description", () => {
    openModelMenu([{ value: "fast", label: "Fast", description: "Uses the small model" }, ...filler], "small");

    expect(marksIn(screen.getByRole("option", { name: /Fast/ }))).toEqual(["small"]);
  });
});

function SlotHarness({ first }: { first: "install" | "signIn" }) {
  const [install, setInstall] = useState<HTMLDivElement | null>(null);
  const [signIn, setSignIn] = useState<HTMLDivElement | null>(null);
  const [step, setStep] = useState(0);
  const showInstall = first === "install" ? step >= 1 : step >= 2;
  const showSignIn = first === "signIn" ? step >= 1 : step >= 2;
  return (
    <>
      <button onClick={() => setStep((s) => s + 1)}>next</button>
      <ComposerDock onSendMessage={() => {}} aboveCardSlots={{ install: setInstall, signIn: setSignIn }} />
      {showSignIn && signIn && createPortal(<p>sign</p>, signIn)}
      {showInstall && install && createPortal(<p>inst</p>, install)}
    </>
  );
}

describe("the draft's panel slot", () => {
  it.each(["install", "signIn"] as const)("install sits above sign-in in either mount order (%s first)", (first) => {
    const { container } = render(<SlotHarness first={first} />);
    act(() => screen.getByText("next").click());
    act(() => screen.getByText("next").click());

    const slot = container.querySelector("[data-above-card]")!;
    expect([...slot.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["inst", "sign"]);
  });
});
