import type { ExamClientQuestion, QuestionAnswer } from "@/lib/examApi"
import { ChoiceGroup } from "./ChoiceGroup"
import { DiscordScenario } from "./DiscordScenario"
import { ExamClip } from "./ExamClip"

interface QuestionViewProps {
  question: ExamClientQuestion
  answer: QuestionAnswer
  onChange: (part: string, optionId: string) => void
  candidateName?: string
  terminated?: boolean
}

export function QuestionView({ question, answer, onChange, candidateName, terminated }: QuestionViewProps) {
  return (
    <div className="space-y-5">
      <h2 className="text-base font-medium leading-snug text-unison-text">{question.prompt}</h2>

      {question.type === "scenario" ? (
        <DiscordScenario
          surfaces={question.steps ?? []}
          answer={answer}
          onChange={onChange}
          candidateName={candidateName}
          oneShot={question.category === "capstone"}
          terminated={terminated}
        />
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
