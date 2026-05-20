import type { LlmTurnResult, PromptModuleId } from "@/lib/domain/types";

export function mockLlmResponse(
  moduleId: PromptModuleId,
  context: { userMessage?: string; subStep: string },
): LlmTurnResult {
  const msg = (context.userMessage ?? "").toLowerCase();
  const hasUserText = (context.userMessage?.trim().length ?? 0) > 8;

  switch (moduleId) {
    case "P1": {
      if (
        /看不懂|不懂|已经说|说得很清楚/.test(context.userMessage ?? "")
      ) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "抱歉，我换种更具体的说法。",
          coachQuestion:
            "Body1 先写就业/技能，Body2 先写学术/知识——请填左侧审题定稿并提交，可以吗？",
          userVisibleText: "不是在考你审题，而是帮你定两个分论点方向。",
          extracted: {
            questionType: "discuss",
            taskUnderstanding: "university: job skills vs academic knowledge",
            position: "depends on student career plan; split pathways",
          },
        };
      }
      const rich =
        (msg.includes("discuss") || msg.includes("讨论")) &&
        (msg.includes("技能") ||
          msg.includes("知识") ||
          msg.includes("规划") ||
          msg.includes("学术") ||
          msg.includes("工作"));
      const ready =
        rich &&
        (msg.includes("分开") ||
          msg.includes("技能") ||
          msg.includes("学术") ||
          msg.includes("实操") ||
          context.userMessage!.length > 60);
      if (ready) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "题型、条件立场和两个角度都已清楚。",
          coachQuestion: "",
          userVisibleText:
            "请改填左侧审题定稿并提交：①题意 ②立场 ③Body1 就业/技能 ④Body2 学术/知识（角度自填）。",
          extracted: {
            questionType: "discuss",
            taskUnderstanding: "skills vs knowledge in university education",
            position: "conditional on student goals; separate tracks",
          },
        };
      }
      if (msg.length > 15) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "你正在说题型、立场或两个方向。",
          coachQuestion: "若已有就业 vs 学术两条线，请直接填左侧定稿并提交。",
          userVisibleText: "你正在说题型、立场或两个方向。",
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
        mirror: "先从题目要求说起。",
        coachQuestion: "这题是 discuss 还是 agree/disagree？题目要你比较什么？",
        userVisibleText: "先从题目要求说起。",
      };
    }

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
