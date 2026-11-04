import type { UserQuestion, UserQuestionOption } from '../types';
import { escapeVisible } from './visible-text';

/**
 * Qwen Code's `ask_user_question` tool. The agent sends a normal permission
 * request whose `toolCall._meta` says `qwenInteractionKind: "user_question"` and
 * lists the questions in `qwenQuestions`; the answer is the usual outcome plus an
 * `answers` object (question number to text), which the backend checks and sends
 * (`acp/permission_response.rs`). Anything that does not parse stays a plain
 * permission card.
 */

/** The tool takes one to four questions, each with two to four options. */
const MAX_QUESTIONS = 4;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;

/** Longest text kept of what the agent sent; the rest is cut. */
const MAX_QUESTION_CHARS = 1000;
const MAX_HEADER_CHARS = 40;
const MAX_LABEL_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 500;

/**
 * The longest free-text answer. The backend takes 2000 characters per answer:
 * four options of 200 characters, their separators and this still fit.
 */
export const MAX_OTHER_CHARS = 1000;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What the agent sent, made visible and cut: it is shown, and sent back as the answer, as it reads here. */
function clean(text: string, max: number): string {
  const visible = escapeVisible(text.trim());
  return visible.length > max ? `${visible.slice(0, max - 1)}…` : visible;
}

function parseOption(raw: unknown): UserQuestionOption | undefined {
  if (!isObject(raw) || typeof raw.label !== 'string') return undefined;
  const label = clean(raw.label, MAX_LABEL_CHARS);
  if (label === '') return undefined;
  const description = typeof raw.description === 'string' ? clean(raw.description, MAX_DESCRIPTION_CHARS) : '';
  return description === '' ? { label } : { label, description };
}

function parseQuestion(raw: unknown): UserQuestion | undefined {
  if (!isObject(raw) || typeof raw.question !== 'string') return undefined;
  const question = clean(raw.question, MAX_QUESTION_CHARS);
  if (question === '') return undefined;
  if (!Array.isArray(raw.options) || raw.options.length < MIN_OPTIONS || raw.options.length > MAX_OPTIONS) {
    return undefined;
  }
  const options = raw.options.map(parseOption);
  if (!options.every((option): option is UserQuestionOption => option !== undefined)) return undefined;
  // A label is the answer: two of the same could not be told apart.
  if (new Set(options.map((option) => option.label)).size !== options.length) return undefined;
  if (raw.multiSelect !== undefined && typeof raw.multiSelect !== 'boolean') return undefined;
  const header = typeof raw.header === 'string' ? clean(raw.header, MAX_HEADER_CHARS) : '';
  return { question, header, options, multiSelect: raw.multiSelect === true };
}

/**
 * The questions of an `ask_user_question` permission request, or undefined when
 * the request is not one or its shape is not what the tool sends.
 */
export function parseUserQuestions(toolCall: unknown): UserQuestion[] | undefined {
  if (!isObject(toolCall) || !isObject(toolCall._meta)) return undefined;
  const meta = toolCall._meta;
  if (meta.qwenInteractionKind !== 'user_question') return undefined;
  const raw = meta.qwenQuestions;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_QUESTIONS) return undefined;
  const questions = raw.map(parseQuestion);
  return questions.every((question): question is UserQuestion => question !== undefined) ? questions : undefined;
}

/** What the user has picked or typed for one question. Lives in the form only, never stored. */
export interface QuestionDraft {
  /** The labels of the picked options. */
  picked: string[];
  /** Whether "Other" is the answer (or one of them, for a multi-select question). */
  otherChecked: boolean;
  otherText: string;
}

export const EMPTY_DRAFT: QuestionDraft = { picked: [], otherChecked: false, otherText: '' };

/** The answer to one question as text, or undefined while it has none. A multi-select question's picks are joined with ", ". */
export function answerOf(question: UserQuestion, draft: QuestionDraft): string | undefined {
  const other = draft.otherChecked ? draft.otherText.trim() : '';
  const labels = question.options.map((option) => option.label).filter((label) => draft.picked.includes(label));
  const parts = question.multiSelect ? [...labels, ...(other === '' ? [] : [other])] : other !== '' ? [other] : labels.slice(0, 1);
  return parts.length === 0 ? undefined : parts.join(', ');
}

/**
 * The `answers` of a response: question number to text. Undefined until every
 * question has an answer.
 */
export function answersOf(
  questions: readonly UserQuestion[],
  drafts: readonly QuestionDraft[],
): Record<string, string> | undefined {
  const answers: Record<string, string> = {};
  for (const [index, question] of questions.entries()) {
    const answer = answerOf(question, drafts[index] ?? EMPTY_DRAFT);
    if (answer === undefined) return undefined;
    answers[String(index)] = answer;
  }
  return answers;
}
