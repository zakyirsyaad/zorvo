import { useEffect, useRef } from "react";

/**
 * Focus for an ask-first row action (Remove): the confirming button takes focus when the question
 * shows, and the button that asked gets it back when the question goes away without an answer.
 */
export function useConfirmFocus(isConfirming: boolean) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const returnRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (isConfirming) confirmRef.current?.focus();
    else if (wasConfirming.current) returnRef.current?.focus();
    wasConfirming.current = isConfirming;
  }, [isConfirming]);
  return { confirmRef, returnRef };
}
