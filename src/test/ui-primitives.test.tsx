import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Popover, PopoverHeader, PopoverOption } from "../components/ui/Popover";
import { Toast, ToastStack } from "../components/ui/Toast";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { StatusLine } from "../components/ui/StatusLine";
import { Chip } from "../components/ui/Chip";
import { Tabs, tabIds, type TabItem } from "../components/ui/Tabs";

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

describe("Tabs", () => {
  type Id = "changes" | "activity" | "files";
  const TABS: readonly TabItem<Id>[] = [
    { id: "changes", label: "Changes", count: 3 },
    { id: "activity", label: "Activity" },
    { id: "files", label: "Files", count: 0 },
  ];
  const renderTabs = (selected: Id, onSelect = vi.fn()) =>
    render(<Tabs tabs={TABS} selected={selected} onSelect={onSelect} label="Inspector" idPrefix="insp" />);

  it("marks the selected tab", () => {
    renderTabs("changes");
    expect(screen.getByRole("tablist", { name: "Inspector" })).toBeInTheDocument();
    const changes = screen.getByRole("tab", { name: /Changes/ });
    expect(changes).toHaveAttribute("aria-selected", "true");
    expect(changes).toHaveAttribute("tabindex", "0");
    expect(changes).toHaveClass("border-fg", "text-fg");
    expect(changes).toHaveAttribute("aria-controls", tabIds("insp", "changes").panel);
    expect(changes).toHaveAttribute("id", tabIds("insp", "changes").tab);
    const activity = screen.getByRole("tab", { name: "Activity" });
    expect(activity).toHaveAttribute("aria-selected", "false");
    expect(activity).toHaveAttribute("tabindex", "-1");
    expect(activity).toHaveClass("text-fg-muted");
  });

  it("moves and selects with the arrow keys, wrapping", () => {
    const onSelect = vi.fn();
    const { rerender } = renderTabs("files", onSelect);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Files" }), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith("changes");
    expect(screen.getByRole("tab", { name: /Changes/ })).toHaveFocus();

    rerender(<Tabs tabs={TABS} selected="changes" onSelect={onSelect} label="Inspector" idPrefix="insp" />);
    fireEvent.keyDown(screen.getByRole("tab", { name: /Changes/ }), { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenLastCalledWith("files");
  });

  it("jumps with Home and End", () => {
    const onSelect = vi.fn();
    renderTabs("activity", onSelect);
    const activity = screen.getByRole("tab", { name: "Activity" });
    fireEvent.keyDown(activity, { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith("files");
    fireEvent.keyDown(activity, { key: "Home" });
    expect(onSelect).toHaveBeenLastCalledWith("changes");
  });

  it("shows a count only when it is above zero", () => {
    renderTabs("changes");
    expect(screen.getByRole("tab", { name: /Changes/ })).toHaveTextContent("3");
    expect(screen.getByRole("tab", { name: "Files" })).toHaveTextContent(/^Files$/);
  });
});

describe("Popover focus after a choice that moves it", () => {
  function RenameHarness() {
    const [isOpen, setOpen] = useState(true);
    const [isRenaming, setRenaming] = useState(false);
    return (
      <>
        <Popover
          isOpen={isOpen}
          onClose={() => setOpen(false)}
          label="More options"
          trigger={
            <button type="button" onClick={() => setOpen((wasOpen) => !wasOpen)}>
              More options
            </button>
          }
        >
          <PopoverOption
            onSelect={() => {
              setOpen(false);
              setRenaming(true);
            }}
          >
            Rename
          </PopoverOption>
        </Popover>
        {isRenaming && <input aria-label="Rename" autoFocus />}
      </>
    );
  }

  it("leaves focus where the choice put it, rather than on the trigger", () => {
    render(<RenameHarness />);
    const rename = screen.getByRole("menuitem", { name: "Rename" });
    // A keyboard user: focus is inside the menu when the item is chosen.
    rename.focus();
    fireEvent.click(rename);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Rename" }));
  });
});

describe("Popover", () => {
  interface HarnessProps {
    role?: "menu" | "listbox" | "dialog";
    side?: "bottom" | "top";
    onClose?: () => void;
    children?: ReactNode;
  }

  function Harness({ role, side, onClose = () => {}, children }: HarnessProps) {
    const [isOpen, setOpen] = useState(false);
    return (
      <Popover
        isOpen={isOpen}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        trigger={
          <button type="button" onClick={() => setOpen((wasOpen) => !wasOpen)}>
            Mode
          </button>
        }
        label="Mode menu"
        role={role}
        side={side}
      >
        {children ?? (
          <>
            <PopoverHeader>Mode</PopoverHeader>
            <PopoverOption selected onSelect={() => {}}>
              Ask
            </PopoverOption>
            <PopoverOption onSelect={() => {}} description="Edits files without asking">
              Auto
            </PopoverOption>
          </>
        )}
      </Popover>
    );
  }

  const open = () => fireEvent.click(screen.getByRole("button", { name: "Mode" }));

  it("renders its panel only while open, named by label", () => {
    render(<Harness />);
    expect(screen.queryByRole("menu")).toBeNull();
    open();
    expect(screen.getByRole("menu", { name: "Mode menu" })).toHaveClass("bg-surface-3", "shadow-popover", "rounded-lg");
  });

  it("closes on Escape and gives focus back to the trigger", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    open();
    const option = screen.getByRole("menuitem", { name: /Auto/ });
    option.focus();
    fireEvent.keyDown(option, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Mode" })).toHaveFocus();
  });

  it("closes on a click outside but not inside", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    open();
    fireEvent.mouseDown(screen.getByRole("menuitem", { name: /Ask/ }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens above the trigger when side is top", () => {
    render(<Harness side="top" />);
    open();
    expect(screen.getByRole("menu")).toHaveClass("bottom-full", "mb-1");
  });

  it("marks the selected option", () => {
    const { unmount } = render(<Harness role="listbox" />);
    open();
    const selected = screen.getByRole("option", { name: /Ask/ });
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(selected).toHaveClass("bg-surface-hover");
    expect(selected.querySelector("svg")).not.toBeNull();
    const other = screen.getByRole("option", { name: /Auto/ });
    expect(other).toHaveAttribute("aria-selected", "false");
    expect(other.querySelector("svg")).toBeNull();
    unmount();

    render(<Harness />);
    open();
    expect(screen.getByRole("menuitem", { name: /Ask/ })).not.toHaveAttribute("aria-selected");
  });

  it("does not select a disabled option", () => {
    const onSelect = vi.fn();
    render(
      <Harness>
        <PopoverOption disabled onSelect={onSelect}>
          Plan
        </PopoverOption>
      </Harness>,
    );
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Plan" }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("Toast", () => {
  it("shows the message with a dismiss button", () => {
    const onDismiss = vi.fn();
    render(<Toast message="Could not open the link." onDismiss={onDismiss} />);
    expect(screen.getByText("Could not open the link.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("speaks errors as alerts and the rest as status", () => {
    render(
      <>
        <Toast tone="error" message="Failed" onDismiss={() => {}} />
        <Toast tone="warning" message="Careful" onDismiss={() => {}} />
        <Toast tone="info" message="Heads up" onDismiss={() => {}} />
      </>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Failed");
    expect(alert).toHaveClass("border-danger");
    const statuses = screen.getAllByRole("status");
    expect(statuses.map((status) => status.textContent)).toEqual(["Careful", "Heads up"]);
  });

  it("runs its action", () => {
    const onClick = vi.fn();
    render(<Toast tone="error" message="Failed" action={{ label: "Try again", onClick }} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("wraps a long message inside the card", () => {
    const message = "/Users/someone/".repeat(20);
    render(<Toast message={message} onDismiss={() => {}} />);
    expect(screen.getByRole("status")).toHaveClass("w-[340px]");
    expect(screen.getByText(message)).toHaveClass("break-words");
  });

  it("stacks toasts in the corner", () => {
    render(
      <ToastStack>
        <Toast message="One" onDismiss={() => {}} />
      </ToastStack>,
    );
    expect(screen.getByRole("status").parentElement).toHaveClass("absolute", "right-5", "bottom-5", "z-40");
  });
});
