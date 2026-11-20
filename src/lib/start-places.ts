/** The starts a coordinator has under way, before the new session is listed. */
export interface StartPlaces {
  /** Takes a place and returns the call that frees it; freeing twice does nothing. */
  take: (coordinatorId: string) => () => void;
  underWay: (coordinatorId: string) => number;
}

export function createStartPlaces(): StartPlaces {
  const counts = new Map<string, number>();
  return {
    take: (coordinatorId) => {
      counts.set(coordinatorId, (counts.get(coordinatorId) ?? 0) + 1);
      let isFreed = false;
      return () => {
        if (isFreed) return;
        isFreed = true;
        const left = (counts.get(coordinatorId) ?? 1) - 1;
        if (left > 0) counts.set(coordinatorId, left);
        else counts.delete(coordinatorId);
      };
    },
    underWay: (coordinatorId) => counts.get(coordinatorId) ?? 0,
  };
}
