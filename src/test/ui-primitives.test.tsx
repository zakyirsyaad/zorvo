import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { StatusLine } from "../components/ui/StatusLine";
import { Chip } from "../components/ui/Chip";

describe("Button", () => {
  it("defaults to type button and does not submit a form", () => {
    const submit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    const { rerender } = render(
      <form onSubmit={submit}>
        <Button>Go</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(submit).not.toHaveBeenCalled();

    rerender(
      <form onSubmit={submit}>
        <Button type="submit">Go</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("variants use their tokens", () => {
    render(
      <>
        <Button variant="primary">P</Button>
        <Button variant="outline">O</Button>
        <Button variant="ghost">G</Button>
        <Button variant="danger">D</Button>
        <Button>Default</Button>
      </>,
    );
    const primary = screen.getByRole("button", { name: "P" });
    expect(primary).toHaveClass("bg-primary", "text-on-primary");
    expect(primary).toHaveClass("enabled:hover:bg-primary-hover");
    expect(primary).not.toHaveClass("hover:bg-primary-hover");
    expect(screen.getByRole("button", { name: "O" })).toHaveClass("border-border-strong");
    expect(screen.getByRole("button", { name: "G" })).toHaveClass("text-fg-muted");
    expect(screen.getByRole("button", { name: "D" })).toHaveClass(
      "bg-danger-surface",
      "text-danger",
    );
    expect(screen.getByRole("button", { name: "Default" })).toHaveClass("border-border-strong");
  });

  it("gives every variant a 1px border so rows align, outline keeping the visible one", () => {
    render(
      <>
        <Button variant="primary">P</Button>
        <Button variant="outline">O</Button>
        <Button variant="ghost">G</Button>
        <Button variant="danger">D</Button>
      </>,
    );
    for (const name of ["P", "G", "D"]) {
      const b = screen.getByRole("button", { name });
      expect(b).toHaveClass("border", "border-transparent");
    }
    const outline = screen.getByRole("button", { name: "O" });
    expect(outline).toHaveClass("border", "border-border-strong", "text-fg-secondary");
    expect(outline).not.toHaveClass("border-transparent");
  });

  it("renders its icon before the label", () => {
    render(<Button icon={<svg data-testid="icon" />}>Label</Button>);
    const button = screen.getByRole("button", { name: "Label" });
    expect(button.firstElementChild).toBe(screen.getByTestId("icon"));
    expect(button.lastChild?.textContent).toBe("Label");
  });

  it("disabled Button does not fire onClick", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Off
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Off" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("appends className", () => {
    render(
      <Button variant="primary" className="ml-2">
        X
      </Button>,
    );
    expect(screen.getByRole("button", { name: "X" })).toHaveClass("ml-2", "bg-primary");
  });
});

describe("IconButton", () => {
  it("exposes its label", () => {
    render(
      <IconButton label="Close">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute("title", "Close");
  });

  it("primary uses primary tokens, ghost uses muted", () => {
    render(
      <>
        <IconButton label="P" variant="primary">
          <svg />
        </IconButton>
        <IconButton label="G">
          <svg />
        </IconButton>
      </>,
    );
    expect(screen.getByRole("button", { name: "P" })).toHaveClass("bg-primary", "rounded-lg");
    expect(screen.getByRole("button", { name: "G" })).toHaveClass("rounded-md", "text-fg-muted");
  });
});

describe("StatusLine", () => {
  const dotOf = (text: string) => screen.getByText(text).closest("span")?.querySelector('[aria-hidden="true"]');

  it("puts the word next to a dot in the status color", () => {
    render(<StatusLine status="attention">Waiting for you</StatusLine>);
    expect(screen.getByText("Waiting for you")).toBeInTheDocument();
    expect(dotOf("Waiting for you")).toHaveClass("rounded-full", "size-1.5", "bg-status-attention");
  });

  it("maps every status to its token", () => {
    render(
      <>
        <StatusLine status="running">Working</StatusLine>
        <StatusLine status="unread">Finished, unread</StatusLine>
        <StatusLine status="merged">Merged</StatusLine>
        <StatusLine status="danger">Failed</StatusLine>
      </>,
    );
    expect(dotOf("Working")).toHaveClass("bg-status-running");
    expect(dotOf("Finished, unread")).toHaveClass("bg-status-unread");
    expect(dotOf("Merged")).toHaveClass("bg-status-merged");
    expect(dotOf("Failed")).toHaveClass("bg-danger");
  });

  it("pulses only while running, and only when motion is allowed", () => {
    render(
      <>
        <StatusLine status="running">Working</StatusLine>
        <StatusLine status="attention">Waiting for you</StatusLine>
      </>,
    );
    expect(dotOf("Working")).toHaveClass("motion-safe:animate-pulse");
    expect(dotOf("Waiting for you")).not.toHaveClass("motion-safe:animate-pulse");
  });

  it("shows no dot when idle", () => {
    const { container } = render(<StatusLine status="idle">2 h ago</StatusLine>);
    expect(screen.getByText("2 h ago")).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});

describe("Chip", () => {
  it("is a button only when it has an action", () => {
    const onClick = vi.fn();
    const { rerender, container } = render(<Chip onClick={onClick}>Plan 3/7</Chip>);
    const button = screen.getByRole("button", { name: "Plan 3/7" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("focus-ring");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<Chip>main</Chip>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[tabindex], button, a")).toBeNull();
  });

  it("uses the chip size and radius", () => {
    render(<Chip>main</Chip>);
    expect(screen.getByText("main").closest(".h-6")).toHaveClass("h-6", "text-caption", "rounded-md");
  });

  it("draws a border only in the outline variant", () => {
    render(
      <>
        <Chip>Outline</Chip>
        <Chip variant="plain">Plain</Chip>
      </>,
    );
    expect(screen.getByText("Outline").closest(".h-6")).toHaveClass("border-border");
    expect(screen.getByText("Plain").closest(".h-6")).toHaveClass("border-transparent");
  });

  it("hides its icon from assistive tech", () => {
    render(<Chip icon={<svg data-testid="icon" />}>#134 Open</Chip>);
    expect(screen.getByTestId("icon").parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("names itself with label when the text is not enough", () => {
    render(
      <Chip onClick={() => {}} label="42 lines added, 11 removed. Open changes">
        +42 −11
      </Chip>,
    );
    expect(screen.getByRole("button", { name: "42 lines added, 11 removed. Open changes" })).toBeInTheDocument();
  });
});
