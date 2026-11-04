"use client";

// The tracker's Next step cell (4 Nov 2026, Chunk 13): one icon tile, the time, and what
// it is with how long is left, in place of three columns. Inside the next day it goes red
// with a warning tile and says so to a screen reader; inside 72 hours the countdown goes
// amber. The rules are lib/applicationStage nextStepFor.
import Icon from "@/components/ui/Icon";
import { nextStepIcon, type NextStep } from "@/lib/applicationStage";

export default function NextStepCell({ step }: { step: NextStep }) {
  return (
    <div className="nextStep" data-urgency={step.urgency}>
      <span className="nextStepIcon" aria-hidden="true">
        <Icon name={nextStepIcon(step.event.kind, step.urgency)} />
      </span>
      <div className="nextStepBody">
        <div className="nextStepWhen">
          {step.urgency === "red" && <span className="srOnly">Due soon: </span>}
          {step.when ?? "No date yet"}
        </div>
        <div className="nextStepLine" title={step.line}>
          <span className="nextStepName">{step.name}</span>
          {step.left && <span className="nextStepLeft"> · {step.left}</span>}
        </div>
        {step.deadline && <div className="nextStepDeadline">Deadline {step.deadline}</div>}
      </div>
    </div>
  );
}
