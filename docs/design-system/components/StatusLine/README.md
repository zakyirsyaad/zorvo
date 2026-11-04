# StatusLine

A status in words with its colored dot in front, for session rows, the top bar, compare cards and the timeline.

The consumer provides the words ("Waiting for you", "Working", "Finished, unread"); the dot never stands alone.

- `running`: `status-running`, the only dot that pulses, and only when motion is allowed (`motion-safe:animate-pulse`).
- `attention`: `status-attention`, the agent is waiting on you.
- `unread`: `status-unread`, finished while you were elsewhere.
- `merged`: `status-merged`, a merged pull request.
- `danger`: `danger`, a failure.
- `idle`: no dot, the words alone (a relative time such as "2 h ago").
- The dot is 6px (`size-dot`) and hidden from assistive tech; the words carry the meaning.
