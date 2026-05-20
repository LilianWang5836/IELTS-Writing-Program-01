import type { LlmTurnResult, PromptModuleId } from "@/lib/domain/types";

export function mockLlmResponse(
  moduleId: PromptModuleId,
  context: { userMessage?: string; subStep: string },
): LlmTurnResult {
  const msg = (context.userMessage ?? "").toLowerCase();
  const hasUserText = (context.userMessage?.trim().length ?? 0) > 8;

  switch (moduleId) {
    case "P1":
      if (msg.length > 20) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "你在尝试界定题型和立场。",
          coachQuestion: "还能从哪两个不同角度切入这道题？",
          userVisibleText:
            "不错。请继续想角度；整理好后再填入左侧审题定稿并提交。",
          extracted: {
            questionType: "discuss",
            taskUnderstanding: "skills vs knowledge",
            position: "depends on career path",
          },
        };
      }
      return {
        verdict: "coach",
        advance: false,
        userVisibleText:
          "请先说明：题型 + 题目任务 + 你的总体判断（可部分同意）。",
        coachQuestion: "题目中的关键词你最想回应哪一个？",
      };

    case "P1H":
      return {
        verdict: "pass",
        advance: true,
        userVisibleText: "审题定稿清晰，两角度可区分。",
      };

    case "P2_2": {
      const messy = hasUserText && context.userMessage!.length > 40;
      if (messy && !msg.includes("because") && !msg.includes("因为")) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "你已给出分论点方向。",
          coachQuestion: "为什么这个观点成立？请补一层因果。",
          userVisibleText: "论点有了，还缺「为什么成立」。",
          logicBreakdown: {
            target: "body1",
            chainSummary: "仅有观点，链条未闭环",
            slots: { claim: "（已从原文提取）" },
            missing: ["reason"],
          },
        };
      }
      return {
        verdict: "pass",
        advance: true,
        userVisibleText: "Body1 论证链已可读。",
        logicBreakdown: {
          target: "body1",
          chainSummary: "观点→原因→例证，完整",
          slots: {
            claim: "workplace skills matter",
            reason: "employers need ready graduates",
            example: "internship projects",
          },
          missing: [],
        },
        extracted: {
          body1Logic: {
            primaryDriver: "causal",
            raw: context.userMessage,
          },
        },
      };
    }

    case "P2_3":
      return {
        verdict: "pass",
        advance: true,
        userVisibleText: "两段论证链均完整，进入逐句写作。",
        logicBreakdown: {
          target: "body2",
          chainSummary: "与 Body1 维度区分清晰",
          slots: {
            claim: "academic path",
            reason: "research depth",
            support: "contrast employability focus",
          },
          missing: [],
        },
        extracted: {
          body2Logic: { primaryDriver: "causal", raw: context.userMessage },
        },
      };

    case "P3_1":
      return {
        verdict: "assign",
        advance: true,
        userVisibleText: "进入逐句写作：先 Body1 claim 句。",
        modulePlan: {
          body1: ["claim", "reason", "example"],
          body2: ["claim", "reason", "example"],
          conclusion: ["conclusion_restate", "conclusion_summary"],
        },
      };

    case "P3_2":
      if (hasUserText && context.subStep.includes("S3_2")) {
        return {
          verdict: "pass",
          advance: false,
          userVisibleText: "这句功能到位。请点击「确认写入」。",
          syntaxHint: "可尝试用 because / which 明确因果。",
          moduleComplete: true,
        };
      }
      return {
        verdict: "assign",
        advance: false,
        userVisibleText: "请写本句英文（按功能要求，可参考 Keywords）。",
        languageSupport: {
          keywords: ["prioritize", "employability", "graduates"],
          phraseFragments: ["Universities should...", "This is because..."],
          starterStructures: ["Universities should prioritize... because..."],
        },
      };

    case "P3_3":
      return {
        verdict: "pass",
        advance: true,
        userVisibleText: "本段衔接可读，进入下一段。",
        action: "proceed_next_body",
        integratedBodyText: (context.userMessage ?? "Body draft.").slice(0, 200),
      };

    default:
      return {
        verdict: "assign",
        advance: false,
        userVisibleText: "请继续输入。",
      };
  }
}
