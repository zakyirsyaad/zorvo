import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ArtifactCommentStrip } from "../components/artifacts/ArtifactCommentStrip";
import type { ArtifactCommentsState } from "../hooks/useArtifactComments";
import type { AddArtifactReview } from "../hooks/useReviewWiring";
import type { Artifact, ArtifactComment } from "../types";
import { MAX_COMMENT_LENGTH } from "../lib/review-comments";

const ARTIFACT: Artifact = {
  id: "a-0123456789abcdef",
  title: "Session list performance",
  sourcePath: "/w/api/report.html",
  versions: [
    { n: 2, at: 1, bytes: 1 },
    { n: 3, at: 2, bytes: 1 },
  ],
};
const PAGE = { sessionId: "s-1", artifactId: ARTIFACT.id, version: 3 };

const comment = (id: string, overrides: Partial<ArtifactComment> = {}): ArtifactComment => ({
  id,
  artifactId: ARTIFACT.id,
  version: 3,
  anchor: { kind: "element", tag: "div", classes: [], text: "In grouping 44%", path: "div" },
  body: `Body of ${id}`,
  createdAt: Number(id.replace(/\D/g, "")) || 1,
  ...overrides,
});

function state(overrides: Partial<ArtifactCommentsState> = {}): ArtifactCommentsState {
  return {
    sessionId: "s-1",
    comments: [],
    isCommenting: false,
    setCommenting: vi.fn(),
    candidate: null,
    candidateBody: () => "",
    setCandidateBody: vi.fn(),
    cancelCandidate: vi.fn(),
    saveCandidate: vi.fn(() => "saved" as const),
    missing: new Set(),
    startArtboardComment: vi.fn(),
    canvasMissing: new Map(),
    editComment: vi.fn(),
    deleteComment: vi.fn(),
    clearSent: vi.fn(),
    ...overrides,
  };
}

function review(overrides: Partial<AddArtifactReview> = {}): AddArtifactReview {
  return { inMessage: new Set(), blockedReason: undefined, add: vi.fn(), addCanvas: vi.fn(), ...overrides };
}

function strip(comments: ArtifactCommentsState, addReview: AddArtifactReview = review(), shownVersion = 3) {
  return render(<ArtifactCommentStrip artifact={ARTIFACT} shownVersion={shownVersion} cwd="/w/api" comments={comments} addReview={addReview} />);
}

const rows = () => within(screen.getByRole("list", { name: "Comments" })).queryAllByRole("listitem");

describe("ArtifactCommentStrip", () => {
  it("puts the keyboard in the comment box when a pick makes a candidate", () => {
    // The page had the keyboard while the user picked; what they type next must not reach it.
    const candidate = { page: PAGE, anchor: comment("c1").anchor, isPickHeld: false };
    strip(state({ candidate, isCommenting: true }));

    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: /^Comment on/ }));
  });

  it("stops a comment at 2,000 characters while it is written, so nothing is cut when it is saved", () => {
    const candidate = { page: PAGE, anchor: comment("c1").anchor, isPickHeld: false };
    strip(state({ candidate, comments: [comment("c2")] }));

    expect(screen.getByRole("textbox", { name: /^Comment on/ }).getAttribute("maxlength")).toBe(String(MAX_COMMENT_LENGTH));
    fireEvent.click(within(rows()[0]).getByRole("button", { name: "Edit" }));
    expect(within(rows()[0]).getByRole("textbox", { name: "Edit comment 1" }).getAttribute("maxlength")).toBe(String(MAX_COMMENT_LENGTH));
  });

  it("gives the keyboard back to a held comment when another pick is refused", () => {
    const candidate = { page: PAGE, anchor: comment("c1").anchor, isPickHeld: false };
    const comments = state({ candidate, isCommenting: true, candidateBody: () => "Half written" });
    const { rerender } = strip(comments);
    const box = screen.getByRole("textbox", { name: /^Comment on/ });
    box.blur();

    const held = { ...comments, candidate: { ...candidate, isPickHeld: true } };
    rerender(<ArtifactCommentStrip artifact={ARTIFACT} shownVersion={3} cwd="/w/api" comments={held} addReview={review()} />);

    expect(document.activeElement).toBe(box);
  });

  it("the strip shows a candidate, saves it, and lists it as 1", () => {
    const candidate = { page: PAGE, anchor: comment("c1").anchor, isPickHeld: false };
    const comments = state({ candidate, isCommenting: true });
    const { rerender } = strip(comments);

    expect(screen.getByText('Element "In grouping 44%"')).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: /Comment on/ }), { target: { value: "Make this the headline." } });
    expect(comments.setCandidateBody).toHaveBeenLastCalledWith("Make this the headline.");
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    expect(comments.saveCandidate).toHaveBeenCalledTimes(1);

    rerender(
      <ArtifactCommentStrip artifact={ARTIFACT} shownVersion={3} cwd="/w/api" comments={state({ comments: [comment("c1")], isCommenting: true })} addReview={review()} />,
    );
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]).getByText("1")).toBeTruthy();
  });

  it("shows nothing while comment mode is off and there are no comments", () => {
    const { container } = strip(state());
    expect(container.innerHTML).toBe("");
  });

  it("an outdated row names both versions and keeps its Add", () => {
    const addReview = review();
    strip(state({ comments: [comment("c1", { version: 2 })] }), addReview);

    const row = rows()[0];
    expect(within(row).getByText("Written on Version 2; the page is now Version 3.")).toBeTruthy();
    expect(within(row).getByText(/Outdated/)).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Add to message" }));
    expect(addReview.add).toHaveBeenCalledWith([expect.objectContaining({ number: 1, status: "outdated" })], ARTIFACT, "/w/api");
  });

  it("Add N counts only current comments not in the message or sent", () => {
    const comments = [comment("c1"), comment("c2"), comment("c3", { sentAt: 5 }), comment("c4", { version: 2 })];
    strip(state({ comments }), review({ inMessage: new Set(["c2"]) }));

    expect(screen.getByText("1 comment not in a message")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add 1 to message" })).toBeTruthy();
    const [first, second, third] = rows();
    expect(within(first).getByText(/Current/)).toBeTruthy();
    expect(within(second).getByText(/In message/)).toBeTruthy();
    expect(within(second).queryByRole("button", { name: /Add/ })).toBeNull();
    expect(within(third).getByText(/Sent/)).toBeTruthy();
    expect(within(third).getByRole("button", { name: "Add again" })).toBeTruthy();
  });

  it("Add N calls addReview.add with the checked comments, the artifact and the cwd", () => {
    const addReview = review();
    strip(state({ comments: [comment("c1"), comment("c2")] }), addReview);

    fireEvent.click(screen.getByRole("button", { name: "Add 2 to message" }));

    expect(addReview.add).toHaveBeenCalledWith(
      [
        { comment: comment("c1"), number: 1, status: "current" },
        { comment: comment("c2"), number: 2, status: "current" },
      ],
      ARTIFACT,
      "/w/api",
    );
  });

  it("Clear sent shows only with a sent comment and clears this artifact", () => {
    const comments = state({ comments: [comment("c1", { sentAt: 5 })] });
    strip(comments);

    fireEvent.click(screen.getByRole("button", { name: "Clear sent" }));

    expect(comments.clearSent).toHaveBeenCalledWith(ARTIFACT.id);
    expect(screen.queryByRole("button", { name: /to message/ })).toBeNull();
  });

  it("a held pick shows its sentence", () => {
    const candidate = { page: PAGE, anchor: comment("c1").anchor, isPickHeld: true };
    strip(state({ candidate, isCommenting: true, candidateBody: () => "Half written" }));

    expect(screen.getByText("Finish or cancel this comment first.")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: /Comment on/ }) as HTMLTextAreaElement).value).toBe("Half written");
  });

  it("a full session says so when saving", () => {
    const candidate = { page: PAGE, anchor: comment("c1").anchor, isPickHeld: false };
    strip(state({ candidate, isCommenting: true, candidateBody: () => "Text", saveCandidate: vi.fn(() => "full" as const) }));

    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));

    expect(screen.getByText("This session has 200 artifact comments. Delete some, or clear the sent ones.")).toBeTruthy();
  });

  it("Delete asks, then deletes", () => {
    const comments = state({ comments: [comment("c1")] });
    strip(comments);

    fireEvent.click(within(rows()[0]).getByRole("button", { name: "Delete" }));
    expect(comments.deleteComment).not.toHaveBeenCalled();
    fireEvent.click(within(rows()[0]).getByRole("button", { name: "Delete comment" }));

    expect(comments.deleteComment).toHaveBeenCalledWith("c1");
  });

  it("Edit saves the new text", () => {
    const comments = state({ comments: [comment("c1")] });
    strip(comments);

    fireEvent.click(within(rows()[0]).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(rows()[0]).getByRole("textbox", { name: "Edit comment 1" }), { target: { value: "New text" } });
    fireEvent.click(within(rows()[0]).getByRole("button", { name: "Save" }));

    expect(comments.editComment).toHaveBeenCalledWith("c1", "New text");
  });

  it("a blocked slot turns Add off with the reason", () => {
    const reason = "The message holds comments for another session. Go back to it, or clear the message.";
    strip(state({ comments: [comment("c1")] }), review({ blockedReason: reason }));

    const addAll = screen.getByRole("button", { name: "Add 1 to message" }) as HTMLButtonElement;
    expect(addAll.disabled).toBe(true);
    expect((within(rows()[0]).getByRole("button", { name: "Add to message" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(reason)).toBeTruthy();
  });

  it("marks a comment the shown page could not find", () => {
    strip(state({ comments: [comment("c1")], missing: new Set([1]) }));

    expect(within(rows()[0]).getByText(/Not found on the page/)).toBeTruthy();
  });

  it("does not say not found for a comment of another version", () => {
    strip(state({ comments: [comment("c1", { version: 2 })], missing: new Set([1]) }));

    expect(within(rows()[0]).queryByText(/Not found on the page/)).toBeNull();
  });
});
