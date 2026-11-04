import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ActionCard } from "../components/ActionCard";
import { applyPermissionRequest } from "../lib/acp-events";
import { EMPTY_DRAFT, MAX_OTHER_CHARS, answerOf, answersOf, parseUserQuestions } from "../lib/user-questions";
import type { ActionCard as ActionCardType, UserQuestion } from "../types";

const COLOURS = {
  question: "Which colours do you like?",
  header: "Colours",
  options: [{ label: "Blue", description: "Like the sea" }, { label: "Green" }],
  multiSelect: true,
};
const EDITOR = {
  question: "Which editor do you use?",
  header: "Editor",
  options: [{ label: "Vim" }, { label: "Zed", description: "Fast" }],
  multiSelect: false,
};

/** What Qwen Code sends for ask_user_question: the questions in `_meta` and in `rawInput`. */
function qwenToolCall(questions: unknown[] = [COLOURS, EDITOR], meta: Record<string, unknown> = {}) {
  return {
    toolCallId: "t-ask",
    title: "Ask user 2 questions",
    kind: "other",
    rawInput: { questions },
    _meta: { toolName: "ask_user_question", qwenInteractionKind: "user_question", qwenQuestions: questions, ...meta },
  };
}

const OPTIONS = [
  { optionId: "proceed_once", name: "Submit", kind: "allow_once" },
  { optionId: "cancel", name: "Cancel", kind: "reject_once" },
];

function questionCard(overrides: Partial<ActionCardType> = {}): ActionCardType {
  return {
    id: "act-1",
    sessionId: "s-1",
    title: "Permission requested",
    prompt: "Ask user 2 questions",
    status: "pending",
    timestamp: 1,
    options: OPTIONS,
    requestId: "ask-1",
    questions: parseUserQuestions(qwenToolCall()),
    ...overrides,
  };
}

const ctx = () => ({ sessionId: "s-1", now: 1, createId: (prefix: string) => `${prefix}-1` });

describe("parseUserQuestions", () => {
  it("reads the questions of an ask_user_question request", () => {
    expect(parseUserQuestions(qwenToolCall())).toEqual([COLOURS, EDITOR]);
  });

  it("defaults a missing header and multiSelect", () => {
    const parsed = parseUserQuestions(qwenToolCall([{ question: "Pick one?", options: [{ label: "A" }, { label: "B" }] }]));

    expect(parsed).toEqual([{ question: "Pick one?", header: "", options: [{ label: "A" }, { label: "B" }], multiSelect: false }]);
  });

  it("is not a question request without the Qwen marker", () => {
    expect(parseUserQuestions({ title: "Run it" })).toBeUndefined();
    expect(parseUserQuestions(null)).toBeUndefined();
    expect(parseUserQuestions(qwenToolCall([COLOURS], { qwenInteractionKind: "plan" }))).toBeUndefined();
    const { _meta, ...withoutMeta } = qwenToolCall();
    expect(_meta).toBeDefined();
    expect(parseUserQuestions(withoutMeta)).toBeUndefined();
  });

  it.each([
    ["no questions", []],
    ["five questions", Array.from({ length: 5 }, () => COLOURS)],
    ["a question that is not an object", ["Which?"]],
    ["a question without text", [{ ...COLOURS, question: "  " }]],
    ["one option only", [{ ...COLOURS, options: [{ label: "Blue" }] }]],
    ["five options", [{ ...COLOURS, options: ["a", "b", "c", "d", "e"].map((label) => ({ label })) }]],
    ["an option without a label", [{ ...COLOURS, options: [{ label: "Blue" }, { description: "x" }] }]],
    ["the same label twice", [{ ...COLOURS, options: [{ label: "Blue" }, { label: "Blue" }] }]],
    ["a multiSelect that is not a boolean", [{ ...COLOURS, multiSelect: "yes" }]],
    ["one good and one bad question", [COLOURS, { question: "x" }]],
  ])("does not parse %s", (_name, questions) => {
    expect(parseUserQuestions(qwenToolCall(questions))).toBeUndefined();
  });

  it("does not parse questions that are not a list", () => {
    expect(parseUserQuestions(qwenToolCall([], { qwenQuestions: "nope" }))).toBeUndefined();
  });

  it("shows control characters and hidden marks as visible escapes, and cuts long text", () => {
    const parsed = parseUserQuestions(
      qwenToolCall([
        { question: "Run‮evil?", header: "H", options: [{ label: "A\u0007" }, { label: "x".repeat(500) }], multiSelect: false },
      ]),
    )!;

    expect(parsed[0].question).toBe("Run\\u202Eevil?");
    expect(parsed[0].options[0].label).toBe("A\\u0007");
    expect(parsed[0].options[1].label).toHaveLength(200);
  });
});

describe("answers", () => {
  const [colours, editor] = parseUserQuestions(qwenToolCall()) as UserQuestion[];

  it("is the picked option of a single-choice question", () => {
    expect(answerOf(editor, { ...EMPTY_DRAFT, picked: ["Zed"] })).toBe("Zed");
  });

  it("joins the picks of a multi-select question with a comma, in the order of the options", () => {
    expect(answerOf(colours, { ...EMPTY_DRAFT, picked: ["Green", "Blue"] })).toBe("Blue, Green");
  });

  it("is the typed text when Other is chosen, and adds it to the picks of a multi-select question", () => {
    expect(answerOf(editor, { picked: ["Vim"], otherChecked: true, otherText: "  Helix " })).toBe("Helix");
    expect(answerOf(colours, { picked: ["Blue"], otherChecked: true, otherText: "Red" })).toBe("Blue, Red");
  });

  it("has no answer while nothing is picked or Other is empty", () => {
    expect(answerOf(editor, EMPTY_DRAFT)).toBeUndefined();
    expect(answerOf(editor, { picked: [], otherChecked: true, otherText: "   " })).toBeUndefined();
    expect(answerOf(colours, { picked: ["Blue"], otherChecked: false, otherText: "ignored" })).toBe("Blue");
  });

  it("builds the answers by question number once every question has one", () => {
    expect(answersOf([colours, editor], [{ ...EMPTY_DRAFT, picked: ["Blue"] }])).toBeUndefined();
    expect(answersOf([colours, editor], [{ ...EMPTY_DRAFT, picked: ["Blue"] }, { ...EMPTY_DRAFT, picked: ["Vim"] }])).toEqual({
      "0": "Blue",
      "1": "Vim",
    });
  });
});

describe("a permission request that asks questions", () => {
  const request = {
    requestId: "ask-1",
    toolCall: qwenToolCall(),
    options: OPTIONS,
  };

  it("becomes a card with the questions and the agent's own options", () => {
    const card = applyPermissionRequest([], request, ctx())[0].actionCard!;

    expect(card.questions).toEqual([COLOURS, EDITOR]);
    expect(card.options?.map((o) => o.optionId)).toEqual(["proceed_once", "cancel"]);
    expect(card.prompt).toBe("Ask user 2 questions");
  });

  it("stays a plain card when the questions do not parse", () => {
    const card = applyPermissionRequest([], { ...request, toolCall: qwenToolCall([{ question: "x" }]) }, ctx())[0].actionCard!;

    expect(card.questions).toBeUndefined();
    expect(card.options).toHaveLength(2);
  });

  it("does not turn another tool's request into questions", () => {
    const card = applyPermissionRequest([], { ...request, toolCall: { title: "Run it", rawInput: { questions: [COLOURS] } } }, ctx())[0].actionCard!;

    expect(card.questions).toBeUndefined();
  });
});

describe("ActionCard with questions", () => {
  const colours = () => screen.getByRole("group", { name: /Which colours/ });
  const editor = () => screen.getByRole("group", { name: /Which editor/ });
  const submit = () => screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement;

  it("shows each question with its header, options and descriptions", () => {
    render(<ActionCard card={questionCard()} onChoose={() => {}} />);

    expect(within(colours()).getByText("Colours")).toBeDefined();
    expect(within(colours()).getAllByRole("checkbox", { name: /Blue|Green|Other/ })).toHaveLength(3);
    expect(within(colours()).getByText("Like the sea")).toBeDefined();
    expect(within(colours()).getByText("Pick all that apply.")).toBeDefined();
    expect(within(editor()).getAllByRole("radio")).toHaveLength(3);
    expect(within(editor()).getByRole("textbox", { name: "Other answer for Editor" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  });

  it("holds Submit back until every question has an answer", () => {
    render(<ActionCard card={questionCard()} onChoose={() => {}} />);
    expect(submit().disabled).toBe(true);
    expect(screen.getByText("Answer every question to submit.")).toBeDefined();
    expect(submit().getAttribute("aria-describedby")).not.toBeNull();

    fireEvent.click(within(colours()).getByRole("checkbox", { name: /Blue/ }));
    expect(submit().disabled).toBe(true);

    fireEvent.click(within(editor()).getByRole("radio", { name: /Zed/ }));
    expect(submit().disabled).toBe(false);
    expect(screen.queryByText("Answer every question to submit.")).toBeNull();
  });

  it("sends the answers with Submit", () => {
    const onChoose = vi.fn();
    render(<ActionCard card={questionCard()} onChoose={onChoose} />);

    fireEvent.click(within(colours()).getByRole("checkbox", { name: /Green/ }));
    fireEvent.click(within(colours()).getByRole("checkbox", { name: /Blue/ }));
    fireEvent.click(within(editor()).getByRole("radio", { name: /Vim/ }));
    fireEvent.click(within(editor()).getByRole("radio", { name: /Zed/ }));
    fireEvent.click(submit());

    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith("proceed_once", { "0": "Blue, Green", "1": "Zed" });
  });

  it("takes a typed answer as Other, which replaces a picked option of a single-choice question", () => {
    const onChoose = vi.fn();
    render(<ActionCard card={questionCard()} onChoose={onChoose} />);

    fireEvent.click(within(colours()).getByRole("checkbox", { name: /Blue/ }));
    fireEvent.change(within(colours()).getByRole("textbox"), { target: { value: "Red" } });
    fireEvent.click(within(editor()).getByRole("radio", { name: /Vim/ }));
    fireEvent.change(within(editor()).getByRole("textbox"), { target: { value: "Helix" } });
    expect((within(editor()).getByRole("radio", { name: /Vim/ }) as HTMLInputElement).checked).toBe(false);
    expect((within(editor()).getByRole("radio", { name: "Other" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(submit());

    expect(onChoose).toHaveBeenCalledWith("proceed_once", { "0": "Blue, Red", "1": "Helix" });
  });

  it("needs words for Other: an empty one is no answer", () => {
    render(<ActionCard card={questionCard()} onChoose={() => {}} />);

    fireEvent.click(within(colours()).getByRole("checkbox", { name: /Blue/ }));
    fireEvent.click(within(editor()).getByRole("radio", { name: "Other" }));

    expect(submit().disabled).toBe(true);
  });

  it("limits a typed answer", () => {
    render(<ActionCard card={questionCard()} onChoose={() => {}} />);

    expect(within(editor()).getByRole("textbox").getAttribute("maxlength")).toBe(String(MAX_OTHER_CHARS));
  });

  it("declines with Cancel, without answers, even when nothing is answered", () => {
    const onChoose = vi.fn();
    render(<ActionCard card={questionCard()} onChoose={onChoose} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onChoose).toHaveBeenCalledWith("cancel");
  });

  it("keeps what was picked when the answer did not go through and the card is asked again", () => {
    const { rerender } = render(<ActionCard card={questionCard()} onChoose={() => {}} />);
    fireEvent.click(within(colours()).getByRole("checkbox", { name: /Blue/ }));
    fireEvent.click(within(editor()).getByRole("radio", { name: /Zed/ }));

    rerender(<ActionCard card={questionCard({ status: "approved", chosenOptionId: "proceed_once" })} onChoose={() => {}} />);
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByText("You chose: Submit")).toBeDefined();

    rerender(<ActionCard card={questionCard()} onChoose={() => {}} />);
    expect((within(colours()).getByRole("checkbox", { name: /Blue/ }) as HTMLInputElement).checked).toBe(true);
    expect(submit().disabled).toBe(false);
  });

  it("disables the form while the card is disabled", () => {
    render(<ActionCard card={questionCard()} onChoose={() => {}} disabled />);

    expect((within(colours()).getByRole("checkbox", { name: /Blue/ }) as HTMLInputElement).disabled).toBe(true);
    expect((within(editor()).getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
  });

  it("shows an answered card as a plain line, with none of the answers", () => {
    render(<ActionCard card={questionCard({ status: "rejected", chosenOptionId: "cancel" })} />);

    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByText("You chose: Cancel")).toBeDefined();
  });

  it("is a plain card when it has no allowing option to send the answers with", () => {
    render(<ActionCard card={questionCard({ options: [OPTIONS[1]] })} onChoose={() => {}} />);

    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  });

  it("is a plain card without questions", () => {
    const onChoose = vi.fn();
    render(<ActionCard card={questionCard({ questions: undefined })} onChoose={onChoose} />);

    expect(screen.queryByRole("group")).toBeNull();
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    expect(onChoose).toHaveBeenCalledWith("proceed_once");
  });
});
