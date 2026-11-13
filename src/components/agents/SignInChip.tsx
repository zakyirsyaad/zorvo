import { SIGN_IN_LABELS, type SignInState } from "../../lib/agent-sign-in";

const CHIP = "flex h-5.5 shrink-0 items-center gap-1.5 rounded-md bg-chip px-2 text-caption text-fg-secondary";
/** Every state has a dot, and the word beside it says the state. */
const DOTS: Readonly<Record<SignInState, string>> = {
  ready: "bg-status-running",
  needed: "bg-status-attention",
  unchecked: "bg-fg-subtle",
};

/** An agent's sign-in in its Settings row: Ready, Sign in or Not checked, the sidebar's same state. */
export function SignInChip({ state }: { state: SignInState }) {
  return (
    <span className={CHIP}>
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${DOTS[state]}`} />
      <span className="sr-only">Sign-in: </span>
      {SIGN_IN_LABELS[state]}
    </span>
  );
}
