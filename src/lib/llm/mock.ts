import type { LlmTurnResult, PromptModuleId } from "@/lib/domain/types";

const MOCK_PROPOSAL = {
  questionType: "discuss",
  taskUnderstanding: "讨论大学应侧重就业技能还是为知识而学",
  position: "取决于学生职业规划，可分路径",
  body1Point: "以就业为导向的学生应优先获得可上岗的技能",
  body1Angle: "就业市场与职场技能",
  body2Point: "以学术深造为目标的学生应保留系统学习与知识积累",
  body2Angle: "学术深造与知识体系",
};

export function mockLlmResponse(
  moduleId: PromptModuleId,
  context: { userMessage?: string; subStep: string },
): LlmTurnResult {
  const msg = (context.userMessage ?? "").toLowerCase();
  const hasUserText = (context.userMessage?.trim().length ?? 0) > 8;
  const raw = context.userMessage ?? "";

  switch (moduleId) {
    case "P1": {
      if (/切入面|角度|视角|讨论范围/.test(raw)) {
        return {
          verdict: "coach",
          advance: false,
          mirror:
            "「切入面」不是新观点，而是这一段从题目哪一面展开，比如就业市场 vs 学术深造。",
          coachQuestion:
            "Body1、Body2 各打算用什么词标出两段不同的范围？",
          userVisibleText:
            "「切入面」不是新观点，而是这一段从题目哪一面展开，比如就业市场 vs 学术深造。",
          essaySubstanceSufficient: false,
          extracted: {
            questionType: "discuss",
            taskUnderstanding: MOCK_PROPOSAL.taskUnderstanding,
            position: MOCK_PROPOSAL.position,
            body1Point: "",
            body1Angle: "",
            body2Point: "",
            body2Angle: "",
          },
        };
      }
      if (/看不懂|不懂|已经说|说得很清楚/.test(raw)) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "抱歉，我换种更具体的说法。",
          coachQuestion:
            "Body1 先写就业/技能一侧、Body2 写学术/知识一侧——各用一句话说清你想写什么？",
          userVisibleText: "抱歉，我换种更具体的说法。",
          essaySubstanceSufficient: false,
          extracted: {
            questionType: "discuss",
            taskUnderstanding: MOCK_PROPOSAL.taskUnderstanding,
            position: MOCK_PROPOSAL.position,
          },
        };
      }

      const hasEmploy =
        /就业|工作|技能|实习|职场|job|career|employ/.test(msg);
      const hasAcademic =
        /学术|知识|研究|深造|academic|phd|纯粹/.test(msg);
      const hasPosition =
        /取决于|规划|路径|分流|反之|部分同意|看情况/.test(msg);
      const hasTask = /discuss|讨论|双方|两种/.test(msg);

      const substanceReady =
        hasTask &&
        hasPosition &&
        hasEmploy &&
        hasAcademic &&
        raw.length >= 90 &&
        (/因为|所以|应该|实习|研究|才能/.test(raw) ||
          (raw.match(/。|\./g)?.length ?? 0) >= 2);

      if (substanceReady) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "题型、立场和就业/学术两条线我都听到了，内容够写两段了。",
          coachQuestion: "",
          userVisibleText: "题型、立场和就业/学术两条线我都听到了，内容够写两段了。",
          essaySubstanceSufficient: true,
          proposalSummary:
            "这题是 discuss，你采取条件立场；Body1 走就业技能，Body2 走学术知识，两段角度不同。",
          proposedHandoff: { ...MOCK_PROPOSAL },
          extracted: { ...MOCK_PROPOSAL },
        };
      }

      const contentReady =
        hasTask && hasPosition && hasEmploy && hasAcademic && raw.length > 40;

      if (contentReady) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "两条线有了，还可以各补一句「写什么、为什么」。",
          coachQuestion:
            "就业技能一侧、学术知识一侧，各用一句话说清你想在段里论证什么？",
          userVisibleText: "两条线有了，还可以各补一句「写什么、为什么」。",
          essaySubstanceSufficient: false,
          gapsRemaining: ["两侧尚需更具体的论证方向"],
          extracted: {
            questionType: "discuss",
            taskUnderstanding: MOCK_PROPOSAL.taskUnderstanding,
            position: MOCK_PROPOSAL.position,
            body1Point: "",
            body1Angle: hasEmploy ? "就业与技能" : "",
            body2Point: "",
            body2Angle: hasAcademic ? "学术与知识" : "",
          },
        };
      }

      if (msg.length > 15) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "你正在说题型、立场或两个方向。",
          coachQuestion: "这题要你讨论什么？你的总体判断是什么？",
          userVisibleText: "你正在说题型、立场或两个方向。",
          essaySubstanceSufficient: false,
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
        essaySubstanceSufficient: false,
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
