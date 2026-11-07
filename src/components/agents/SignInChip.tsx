import { SIGN_IN_LABELS, type SignInState } from "../../lib/agent-sign-in";

const CHIP = "flex h-5.5 shrink-0 items-center gap-1.25 rounded-md border px-2 text-caption";
const LOOKS: Readonly<Record<SignInState, { chip: string; dot: string | null }>> = {
  ready: { chip: "border-border text-fg-secondary", dot: "bg-status-running" },
  needed: { chip: "border-status-attention text-status-attention", dot: "bg-status-attention" },
  unchecked: { chip: "border-border text-fg-muted", dot: null },
};

/** An agent's sign-in in its Settings row: Ready, Sign in or Not checked, the sidebar's same state. */
export function SignInChip({ state }: { state: SignInState }) {
  const look = LOOKS[state];
  return (
    <span className={`${CHIP} ${look.chip}`}>
      {look.dot && <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${look.dot}`} />}
      <span className="sr-only">Sign-in: </span>
      {SIGN_IN_LABELS[state]}
    </span>
  );
}
