import { Button } from "./ui/Button";
import { BlockerCard } from "./ui/BlockerCard";

export interface RemovedAgentPanelProps {
  agentName: string;
  /** The agent's id, for its logo. */
  profileId?: string;
  onAdd: () => void;
}

/** Takes the composer's place in a saved session whose agent was removed: the transcript stays readable. */
export function RemovedAgentPanel({ agentName, profileId, onAdd }: RemovedAgentPanelProps) {
  const title = `${agentName} is no longer in use`;
  return (
    <div className="w-full max-w-chat">
      <BlockerCard
        label={title}
        profileId={profileId}
        title={title}
        actions={
          <Button variant="primary" onClick={onAdd}>
            {`Add ${agentName}`}
          </Button>
        }
      >
        Add it again to continue this session. Its messages stay here either way.
      </BlockerCard>
    </div>
  );
}
