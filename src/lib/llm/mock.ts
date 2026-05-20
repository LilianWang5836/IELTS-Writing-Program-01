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

      const bothLabeled =
        /为就业|就业准备/.test(raw) &&
        /知识本身|学术道路/.test(raw) &&
        raw.length >= 40;
      const richBothSides =
        hasEmploy &&
        hasAcademic &&
        (/项目|实习|实操|课本|竞争优势/.test(raw) ||
          /尽快工作|工作技能/.test(raw)) &&
        (/课程|由浅入深|系统|医学|专业理论|领域|持续.*学习/.test(raw) ||
          /知识本身|学术道路/.test(raw)) &&
        raw.length >= 30;
      const substanceReady =
        bothLabeled ||
        richBothSides ||
        (hasTask &&
          hasPosition &&
          hasEmploy &&
          hasAcademic &&
          raw.length >= 90 &&
          (/因为|所以|应该|实习|研究|才能/.test(raw) ||
            (raw.match(/。|\./g)?.length ?? 0) >= 2));

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

      if (contentReady && !substanceReady) {
        const needAcademic =
          hasEmploy && hasAcademic && raw.length < 50 && !/系统性|积累|学术道路/.test(raw);
        return {
          verdict: "coach",
          advance: false,
          mirror: needAcademic
            ? "题型和立场清楚了，学术/知识一侧还可以再写实一点。"
            : "两条线有了，还可以各补一句「写什么、为什么」。",
          coachQuestion: needAcademic
            ? "学术/知识一侧：补一句「写什么 + 为什么」（例如长期学习、研究兴趣）"
            : "就业技能一侧、学术知识一侧，各用一句话说清你想在段里论证什么？",
          userVisibleText: needAcademic
            ? "题型和立场清楚了，学术/知识一侧还可以再写实一点。"
            : "两条线有了，还可以各补一句「写什么、为什么」。",
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

      if (hasEmploy && hasAcademic && raw.length > 20) {
        return {
          verdict: "coach",
          advance: false,
          mirror: richBothSides
            ? "就业与学术两条线我都听到了。"
            : "两条线方向有了，还可以各补一句具体写什么。",
          coachQuestion: richBothSides
            ? ""
            : "就业技能一侧、学术知识一侧，各用一句话说清你想在段里论证什么？",
          userVisibleText: richBothSides
            ? "就业与学术两条线我都听到了。"
            : "两条线方向有了，还可以各补一句具体写什么。",
          essaySubstanceSufficient: !!richBothSides,
          ...(richBothSides
            ? {
                proposalSummary:
                  "这题是 discuss，你采取条件立场；Body1 走就业技能，Body2 走学术知识。",
                proposedHandoff: { ...MOCK_PROPOSAL },
              }
            : { gapsRemaining: ["两侧尚需更具体的论证方向"] }),
          extracted: {
            questionType: "discuss",
            taskUnderstanding: MOCK_PROPOSAL.taskUnderstanding,
            position: MOCK_PROPOSAL.position,
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
      const raw = context.userMessage ?? "";
      if (/不知道怎么串|不会串|怎么连/.test(raw)) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "没关系，我根据你已说的先搭一版骨架。",
          coachQuestion:
            "这条线是否顺？要改请说哪一环（论点/原因/例子/扣题）。",
          userVisibleText: "",
          paragraphSubstanceSufficient: false,
        };
      }

      if (/满意|够了吗/.test(raw)) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "我们继续按链条补环，不用急着收尾。",
          coachQuestion: "还缺哪一环？你可以补例子或扣题到「尽快就业」。",
          userVisibleText: "",
          paragraphSubstanceSufficient: false,
        };
      }

      const hasExample = /项目|实习|coding|编程|实践|工程师/.test(raw);
      const hasReason = /因为|所以|才能|直接|更容易|有助于/.test(raw);
      const hasLink = /就业|求职|竞争|找工作|上岗/.test(raw);
      const substanceReady =
        hasExample && hasReason && hasLink && raw.length >= 40;

      if (!hasUserText || raw.length < 15) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "我们按链条一环一环来。",
          coachQuestion:
            "先补原因：为什么提供工作技能，能帮助学生更快就业？",
          userVisibleText: "",
          paragraphSubstanceSufficient: false,
        };
      }

      if (!hasExample) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "论点/原因方向有了。",
          coachQuestion:
            "给一个具体例子：学校可提供什么实践或项目？（如 coding 项目、实习）",
          userVisibleText: "",
          paragraphSubstanceSufficient: false,
        };
      }

      if (!hasReason) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "例子很具体。",
          coachQuestion:
            "补一层因果：这些技能/项目如何让学生更快找到工作？",
          userVisibleText: "",
          paragraphSubstanceSufficient: false,
        };
      }

      if (!hasLink || !substanceReady) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "例子和原因都有了。",
          coachQuestion:
            "扣题到审题：这些能力如何落到「帮助学生尽快就业」？（一句话）",
          userVisibleText: "",
          paragraphSubstanceSufficient: false,
        };
      }

      const proposal = {
        chainSummary: "提供工作技能 → 项目/实习练技能 → 更易就业",
        slots: {
          claim: "大学提供工作技能",
          reason: "代码/项目规划等可直接用于工作，项目经验助找实习",
          example: "与工种相关的实践项目（如工程师自己 coding 做项目）",
          link: "在求职中获得竞争优势、更快就业",
        },
        draft: raw,
      };
      return {
        verdict: "coach",
        advance: false,
        mirror: "",
        coachQuestion: "",
        userVisibleText: "",
        paragraphSubstanceSufficient: true,
        proposalSummary: "四环齐了，请看左侧「确认链条并填入」。",
        chainProposal: proposal,
        extracted: {
          body1Logic: {
            primaryDriver: "causal",
            slots: proposal.slots,
            raw,
          },
        },
      };
    }

    case "P2_3": {
      const raw = context.userMessage ?? "";

      if (/不知道怎么串|不会串|怎么连/.test(raw)) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "没关系，我根据你已说的先搭一版学术侧骨架。",
          coachQuestion:
            "这条线是否顺？要改请说哪一环（论点/原因/支撑/扣题）。",
          userVisibleText: "",
          paragraphSubstanceSufficient: false,
        };
      }

      if (/满意|够了吗/.test(raw)) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "我们继续按链条补环。",
          coachQuestion:
            "请补：知识/课程/研究如何支撑深造，而不是只说「需要时间」。",
          userVisibleText: "",
          paragraphSubstanceSufficient: false,
        };
      }

      const hasAcademic =
        /研究|论文|导师|课程|领域|深造|知识|学术|科研|读研/.test(raw);
      const hasReason = /因为|所以|才能|有助于|基础|积累/.test(raw);
      const hasSupport = /课程|研究|导师|项目|兴趣|训练/.test(raw);
      const hasLink = /深造|读研|学术|科研|博士|研究生/.test(raw);
      const weakAcademic =
        raw.length < 40 || (!hasAcademic && /时间|学习/.test(raw));
      const substanceReady =
        hasAcademic && hasReason && hasSupport && hasLink && raw.length >= 45;

      if (!hasUserText || raw.length < 15) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "我们按学术侧链条一环一环来。",
          coachQuestion:
            "先说明：走学术道路时，持续学领域知识想达到什么结果？（一句话）",
          userVisibleText: "",
          paragraphSubstanceSufficient: false,
        };
      }

      if (!hasReason && !weakAcademic) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "学术方向有了。",
          coachQuestion:
            "补因果：为什么系统积累领域知识，是学术深造的基础？",
          userVisibleText: "",
          paragraphSubstanceSufficient: false,
        };
      }

      if (!hasSupport) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "原因方向有了。",
          coachQuestion:
            "给一个具体支撑：课程/研究兴趣/导师指导等如何体现？",
          userVisibleText: "",
          paragraphSubstanceSufficient: false,
        };
      }

      if (weakAcademic || !hasLink || !substanceReady) {
        return {
          verdict: "coach",
          advance: false,
          mirror: "支撑有了，还可以更贴学术路径。",
          coachQuestion:
            "扣题：这些积累如何落到「学术深造/读研」？别只说学习要时间。",
          userVisibleText: "",
          paragraphSubstanceSufficient: false,
        };
      }

      const proposal = {
        chainSummary: "持续深耕领域知识 → 才能进入学术深造路径",
        slots: {
          claim: "走学术道路需持续学习感兴趣领域",
          reason: "系统知识积累是研究训练的基础",
          support: "与就业导向的技能培养形成不同路径",
          link: "支撑长期学术深造",
        },
        draft: raw,
      };
      return {
        verdict: "coach",
        advance: false,
        mirror: "",
        coachQuestion: "",
        userVisibleText: "",
        paragraphSubstanceSufficient: true,
        proposalSummary: "四环齐了，请看左侧「确认链条并填入」。",
        chainProposal: proposal,
        extracted: {
          body2Logic: {
            primaryDriver: "causal",
            slots: proposal.slots,
            raw,
          },
        },
      };
    }

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
