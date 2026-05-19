import type { LlmTurnResult, PromptModuleId } from "@/lib/domain/types";

export function mockLlmResponse(
  moduleId: PromptModuleId,
  context: { userMessage?: string; subStep: string },
): LlmTurnResult {
  const msg = (context.userMessage ?? "").toLowerCase();

  switch (moduleId) {
    case "P1":
      if (
        msg.includes("agree") ||
        msg.includes("disagree") ||
        msg.includes("discuss") ||
        msg.includes("同意") ||
        msg.includes("不同意") ||
        msg.includes("讨论") ||
        msg.length > 30
      ) {
        return {
          verdict: "pass",
          userVisibleText:
            "审题完全正确！现在我们进入【Stage 2】。请直接告诉我：Body 1 和 Body 2 分别用哪两个分论点支撑你的总立场？",
          extracted: {
            questionType: "agree/disagree",
            taskUnderstanding: "whether benefits outweigh drawbacks",
            position: "partial agreement with conditions",
          } as Record<string, string>,
        };
      }
      return {
        verdict: "fail",
        userVisibleText:
          "你还没明确题型和题目核心任务。请补充：题型名称 + 题目要你讨论什么 + 你的总体判断（允许部分同意）。",
      };

    case "P2_1":
      return {
        verdict: "pass",
        userVisibleText:
          "两个分论点清晰。请补全 Body1：观点成立，是因为______，产生影响是因为______，可用______支持。",
        extracted: {
          body1Point: "economic growth",
          body2Point: "social inequality",
        },
      };

    case "P2_2":
      return {
        verdict: "pass",
        userVisibleText:
          "Body1 论证信息齐全。请用同样方式补全 Body2 的因果链（原因+机制/支撑）。",
        extracted: {
          body1Logic: { primaryDriver: "causal", raw: context.userMessage },
        },
      };

    case "P2_3":
      return {
        verdict: "pass",
        userVisibleText: "两段论证骨架完成，进入逐句写作训练。",
        extracted: {
          body2Logic: { primaryDriver: "causal", raw: context.userMessage },
        },
      };

    case "P3_1":
      return {
        verdict: "assign",
        userVisibleText:
          "骨架已锁定：先 Body1（claim→reason→example），再 Body2，最后 conclusion。",
        blueprint: {
          body1: {
            coreIdea: "economic benefit",
            logicFlow: {
              claimDirection: "state main benefit",
              reasonDirection: "explain mechanism",
              supportDirection: "real-world example",
            },
          },
          body2: {
            coreIdea: "social cost",
            logicFlow: {
              claimDirection: "state concern",
              reasonDirection: "why it happens",
              supportDirection: "concrete case",
            },
          },
          conclusion: {
            restateDirection: "balanced position",
            summaryLogicDirection: "link both bodies",
          },
        },
        modulePlan: {
          body1: ["claim", "reason", "example"],
          body2: ["claim", "reason", "example"],
          conclusion: ["conclusion_restate", "conclusion_summary"],
        },
      };

    case "P3_2":
      if (context.subStep.includes("feedback") || (context.userMessage?.length ?? 0) > 5) {
        return {
          verdict: "pass",
          userVisibleText: "这句功能到位，可以确认写入左侧。",
          moduleComplete: true,
          confirmedSentence: context.userMessage ?? "",
        };
      }
      return {
        verdict: "assign",
        userVisibleText:
          "请写本段 claim 句，表达明确判断。词块：one key reason / in my view / leads to。",
        moduleComplete: false,
      };

    case "P3_3":
      return {
        verdict: "pass",
        userVisibleText: "本段论证链完整，进入下一段。",
        action: "proceed_next_body",
        integratedBodyText: (context.userMessage ?? "Body draft.").slice(0, 200),
      };

    default:
      return {
        verdict: "assign",
        userVisibleText: "请继续输入。",
      };
  }
}
