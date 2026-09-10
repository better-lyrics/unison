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
      <span className="inline-flex items-center rounded-full border border-unison-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-unison-text-muted">
        {STEP_LABEL[step.kind]}
      </span>
      {step.author ? <p className="text-sm font-semibold text-unison-text">{step.author}</p> : null}
      {step.text ? <p className="text-sm leading-relaxed text-unison-text-secondary">{step.text}</p> : null}
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
      <h2 className="text-base font-medium leading-snug text-unison-text">{question.prompt}</h2>

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
          {question.assets?.clip ? <ExamClip clip={question.assets.clip} /> : null}
          {question.assets?.image ? (
            <img
              src={question.assets.image}
              alt=""
              className="w-full rounded-lg outline outline-1 -outline-offset-1 outline-white/10"
            />
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
