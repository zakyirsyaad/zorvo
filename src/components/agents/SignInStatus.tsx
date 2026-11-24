import { SIGN_IN_STATUS_WORDS, type SignInState } from "../../lib/agent-sign-in";

/**
 * Ready and Needs sign-in have a dot, and the word beside it says the state; the colour is never the only
 * sign. Not checked yet has none: nothing needs doing until the agent is used.
 */
const DOTS: Readonly<Partial<Record<SignInState, string>>> = {
  ready: "bg-status-running",
  needed: "bg-status-attention",
};

/**
 * An agent's sign-in in its Settings row, the sidebar's same state: a dot and a word, with no pill around
 * it, so the row's button stays the only thing that looks pressable.
 */
export function SignInStatus({ state }: { state: SignInState }) {
  return (
    <span className={`flex shrink-0 items-center gap-1.5 text-ui-sm ${state === "unchecked" ? "text-fg-subtle" : "text-fg-muted"}`}>
      {DOTS[state] && <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${DOTS[state]}`} />}
      <span className="sr-only">Sign-in: </span>
      {SIGN_IN_STATUS_WORDS[state]}
    </span>
  );
}
