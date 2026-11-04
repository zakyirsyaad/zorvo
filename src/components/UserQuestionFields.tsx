import { useId } from "react";
import type { UserQuestion } from "../types";
import { EMPTY_DRAFT, MAX_OTHER_CHARS, type QuestionDraft } from "../lib/user-questions";

const INPUT =
  "min-w-0 flex-1 rounded-lg border border-border-strong bg-surface-2 px-2.5 py-1.5 text-xs text-fg " +
  "placeholder:text-fg-subtle focus-ring disabled:opacity-40";

export interface UserQuestionFieldsProps {
  questions: UserQuestion[];
  /** What is picked or typed, per question. The card owns it, so it survives an answer that did not go through. */
  drafts: readonly QuestionDraft[];
  onChange: (index: number, draft: QuestionDraft) => void;
  disabled?: boolean;
}

/**
 * The questions of Qwen Code's `ask_user_question` as a form: the agent's options
 * (one, or several for a multi-select question) and an "Other" answer typed by hand.
 * Holds no state; what is typed is never stored or logged.
 */
export function UserQuestionFields({ questions, drafts, onChange, disabled = false }: UserQuestionFieldsProps) {
  return (
    <div className="mt-3 space-y-4">
      {questions.map((question, index) => (
        <QuestionField
          key={index}
          question={question}
          draft={drafts[index] ?? EMPTY_DRAFT}
          onChange={(draft) => onChange(index, draft)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

interface QuestionFieldProps {
  question: UserQuestion;
  draft: QuestionDraft;
  onChange: (draft: QuestionDraft) => void;
  disabled: boolean;
}

function QuestionField({ question, draft, onChange, disabled }: QuestionFieldProps) {
  const name = useId();
  const type = question.multiSelect ? "checkbox" : "radio";
  const subject = question.header || question.question;

  const toggle = (label: string) =>
    onChange(
      question.multiSelect
        ? { ...draft, picked: draft.picked.includes(label) ? draft.picked.filter((l) => l !== label) : [...draft.picked, label] }
        : { ...draft, picked: [label], otherChecked: false },
    );
  const toggleOther = () =>
    onChange(question.multiSelect ? { ...draft, otherChecked: !draft.otherChecked } : { ...draft, picked: [], otherChecked: true });
  // Typing an answer picks "Other"; for a single choice it replaces the option picked.
  const typeOther = (otherText: string) =>
    onChange(question.multiSelect ? { ...draft, otherChecked: true, otherText } : { picked: [], otherChecked: true, otherText });

  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-semibold text-fg">
        {question.header && (
          <span className="mr-1.5 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-normal text-fg-muted">
            {question.header}
          </span>
        )}
        {question.question}
      </legend>
      {question.multiSelect && <p className="mt-0.5 text-xs text-fg-muted">Pick all that apply.</p>}
      <div className="mt-1.5 space-y-1">
        {question.options.map((option) => (
          <label key={option.label} className="flex items-start gap-2 text-xs text-fg-secondary">
            <input
              type={type}
              name={name}
              className="focus-ring mt-0.5 h-3.5 w-3.5"
              checked={draft.picked.includes(option.label)}
              disabled={disabled}
              onChange={() => toggle(option.label)}
            />
            <span>
              {option.label}
              {option.description && <span className="block text-fg-muted">{option.description}</span>}
            </span>
          </label>
        ))}
        <div className="flex items-center gap-2">
          <label className="flex shrink-0 items-center gap-2 text-xs text-fg-secondary">
            <input
              type={type}
              name={name}
              className="focus-ring h-3.5 w-3.5"
              checked={draft.otherChecked}
              disabled={disabled}
              onChange={toggleOther}
            />
            <span>Other</span>
          </label>
          <input
            type="text"
            className={INPUT}
            aria-label={`Other answer for ${subject}`}
            placeholder="Type your own answer"
            maxLength={MAX_OTHER_CHARS}
            value={draft.otherText}
            disabled={disabled}
            onChange={(e) => typeOther(e.target.value)}
          />
        </div>
      </div>
    </fieldset>
  );
}
