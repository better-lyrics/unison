import type { ExamClientQuestion, QuestionAnswer, ScenarioStep } from "@/lib/examApi"
import { ChoiceGroup } from "./ChoiceGroup"
import { ExamClip } from "./ExamClip"

interface QuestionViewProps {
  question: ExamClientQuestion
  answer: QuestionAnswer
  onChange: (part: string, optionId: string) => void
}

const STEP_LABEL: Record<ScenarioStep["kind"], string> = {
  dm: "Direct message",
  queue: "Review queue",
  channel: "#council",
}

function ScenarioBeat({
  step,
  value,
  onChange,
}: {
  step: ScenarioStep
  value?: string
  onChange: (optionId: string) => void
}) {
  return (
    <div className="space-y-3 rounded-lg bg-white/[0.02] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-unison-text-muted">
        {STEP_LABEL[step.kind]}
      </p>
      {step.author ? <p className="text-sm font-semibold text-unison-text">{step.author}</p> : null}
      {step.text ? <p className="text-sm text-unison-text-secondary">{step.text}</p> : null}
      {step.clip ? <ExamClip clip={step.clip} /> : null}
      <ChoiceGroup
        part={{ part: step.id, label: "Your reply", options: step.choices }}
        value={value}
        onChange={onChange}
      />
    </div>
  )
}

export function QuestionView({ question, answer, onChange }: QuestionViewProps) {
  return (
    <div className="space-y-5">
      <h2 className="text-base font-medium text-unison-text">{question.prompt}</h2>

      {question.type === "scenario" ? (
        <div className="space-y-4">
          {(question.steps ?? []).map((step) => (
            <ScenarioBeat
              key={step.id}
              step={step}
              value={answer[step.id]}
              onChange={(optionId) => onChange(step.id, optionId)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          {(question.assets?.clips ?? []).map((clip) => (
            <ExamClip key={clip.id} clip={clip} />
          ))}
          {question.assets?.image ? (
            <img src={question.assets.image} alt="" className="w-full rounded-lg bg-white/[0.02]" />
          ) : null}
          {(question.choices ?? []).map((part) => (
            <ChoiceGroup
              key={part.part}
              part={part}
              value={answer[part.part]}
              onChange={(optionId) => onChange(part.part, optionId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
