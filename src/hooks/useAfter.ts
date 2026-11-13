import { useEffect, useState } from "react";

/** True once `isOn` has stayed true for `delayMs`, and false again as soon as it is off. */
export function useAfter(isOn: boolean, delayMs: number): boolean {
  const [isPast, setIsPast] = useState(false);
  useEffect(() => {
    if (!isOn) return;
    const timer = setTimeout(() => setIsPast(true), delayMs);
    return () => {
      clearTimeout(timer);
      setIsPast(false);
    };
  }, [isOn, delayMs]);
  return isOn && isPast;
}
