/**
 * Stage 3 逐句写作：一次只修一个结构问题，反馈以中文修复问句为主。
 */
import { normalizeBlueprint } from "./blueprint-from-s2";
import { getCurrentModule } from "./module-compiler";
import type { LlmTurnResult, SessionState } from "./types";

export function getModuleDirection(state: SessionState): string {
  const s3 = state.s3;
  if (!s3) return "";
  const mod = getCurrentModule(s3.modulePlan, s3.currentBody, s3.moduleIndex);
  const bp = normalizeBlueprint(state, s3.blueprint);
  const body = s3.currentBody;
  if (body !== "conclusion" && mod) {
    const b = bp[body as "body1" | "body2"];
    const flow = b?.logicFlow;
    if (flow) {
      if (mod === "claim") return flow.claimDirection;
      if (mod === "reason") return flow.reasonDirection;
      return flow.supportDirection;
    }
  }
  if (mod && bp.conclusion) {
    return mod === "conclusion_restate"
      ? bp.conclusion.restateDirection
      : bp.conclusion.summaryLogicDirection;
  }
  return "";
}

export type SentenceProblemPriority = "P1" | "P2" | "P3";

export type SentenceProblemKind =
  | "missing_subject"
  | "subject_verb_broken"
  | "clause_attachment"
  | "cause_effect_gap"
  | "noun_pile"
  | "collocation"
  | "unclear_wording"
  | "none";

export interface SentenceDiagnosis {
  priority: SentenceProblemPriority;
  kind: SentenceProblemKind;
  labelZh: string;
  repairQuestionZh: string;
  hintZh: string;
  keywords: string[];
  phraseFragments: string[];
  starterStructures: string[];
  pass: boolean;
}

const BANNED_FEEDBACK_RE =
  /grammar\s+issue|grammatical\s+issues?|awkward\s+sentence|improve\s+clarity|word\s+choice|article\s+error|tense\s+error/i;

const SUBJECT_STARTERS =
  /^(universities|university|students?|graduates?|they|it|this|these|those|the\s+\w+|many|some|people|employers|companies|governments?|job\s+seekers?|young\s+people)/i;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function hasFiniteVerb(s: string): boolean {
  return /\b(is|are|was|were|am|be|been|being|have|has|had|do|does|did|can|could|will|would|should|may|might|must|need|needs|help|helps|allow|allows|enable|enables|make|makes|improve|improves|lead|leads|provide|provides|offer|offers|give|gives|get|gets|become|becomes)\b/i.test(
    s,
  );
}

function detectMissingSubject(s: string): boolean {
  if (SUBJECT_STARTERS.test(s)) return false;
  if (/^\s*[A-Za-z]+ing\s+/i.test(s)) return true;
  if (
    /^\s*(accumulate|accumulating|improving|joining|skills|projects|internships?|experiences?)\b/i.test(
      s,
    )
  ) {
    return true;
  }
  if (/^\s*(can|will|may|could|should)\s+\w+/i.test(s) && !SUBJECT_STARTERS.test(s)) {
    return true;
  }
  return false;
}

function detectBrokenWhich(s: string): boolean {
  if (!/\bwhich\b/i.test(s)) return false;
  if (
    /\bwhich\s+(can|could|will|may|might|helps?)\s+\w+(\s+\w+){0,4}\s+(students?|graduates?|people|they)\s+(get|have|obtain|find|gain)\b/i.test(
      s,
    )
  ) {
    return true;
  }
  if (/\bwhich\s+can\s+improve\b/i.test(s) && /\bget\s+jobs\b/i.test(s)) {
    return true;
  }
  return false;
}

function detectClauseAttachment(s: string): boolean {
  if (!/\bwhich\b/i.test(s)) return false;
  const whichCount = (s.match(/\bwhich\b/gi) ?? []).length;
  if (whichCount >= 2) return true;
  if (/\bwhich\b[^.]{0,80}\b(which|that)\b/i.test(s)) return true;
  if (/\b,\s*which\b/i.test(s) && !/\b(students?|graduates?|skills?|universities|this|it|they)\b/i.test(s)) {
    return true;
  }
  return false;
}

function detectCauseEffectGap(s: string): boolean {
  if (/\b(because|since|as a result|therefore|thus|so that|which helps|which leads|leading to)\b/i.test(s)) {
    return false;
  }
  if (
    /,\s*(competitive advantage|more interviews?|better jobs?|employability|job opportunities)\b/i.test(
      s,
    )
  ) {
    return true;
  }
  if (
    /\b(internships?|projects?|practice)\b[^.]{0,40}\b(advantage|jobs?|employability)\b/i.test(s) &&
    !/\b(which|because|so|thus|therefore)\b/i.test(s)
  ) {
    return true;
  }
  return false;
}

function detectNounPile(s: string): boolean {
  const pile =
    /\b(skills?|work|needs?|projects?|internships?|experiences?)\b.*\b(skills?|work|needs?|projects?|internships?)\b.*\b(skills?|work|needs?|projects?|internships?)\b/i;
  if (pile.test(s)) return true;
  if (wordCount(s) >= 8 && !hasFiniteVerb(s)) return true;
  return false;
}

function detectCollocation(s: string): boolean {
  if (/\bimprove\s+employability\s+of\b/i.test(s) && !/\btheir\b/i.test(s)) return false;
  if (/\b(a|an)\s+(employability|competitive|skills)\b/i.test(s)) return true;
  return false;
}

function looksPassable(s: string): boolean {
  const t = s.trim();
  if (wordCount(t) < 6) return false;
  if (!hasFiniteVerb(t)) return false;
  if (detectMissingSubject(t)) return false;
  if (detectBrokenWhich(t)) return false;
  if (detectClauseAttachment(t)) return false;
  if (detectCauseEffectGap(t)) return false;
  if (detectNounPile(t)) return false;
  return true;
}

function scaffoldingFor(
  kind: SentenceProblemKind,
  module?: string,
): Pick<
  SentenceDiagnosis,
  "keywords" | "phraseFragments" | "starterStructures" | "hintZh"
> {
  const base = {
    keywords: [] as string[],
    phraseFragments: [] as string[],
    starterStructures: [] as string[],
    hintZh: "",
  };

  switch (kind) {
    case "missing_subject":
      return {
        ...base,
        hintZh: "先补「谁」再做动作。",
        keywords: ["students", "graduates", "job seekers", "universities"],
        phraseFragments: ["Students can...", "Graduates who...", "Universities should..."],
        starterStructures: ["Students / Graduates + 动词 + ..."],
      };
    case "subject_verb_broken":
    case "clause_attachment":
      return {
        ...base,
        hintZh: "先弄清 which 指代什么，再写结果。",
        keywords: ["which helps", "which leads to", "as a result", "this means"],
        phraseFragments: ["..., which helps...", "..., which leads to...", "As a result, ..."],
        starterStructures: ["主句 + , which + 动词 + 结果"],
      };
    case "cause_effect_gap":
      return {
        ...base,
        hintZh: "用连接词把「原因」和「结果」连起来。",
        keywords: ["which helps", "as a result", "therefore", "so that"],
        phraseFragments: ["..., which helps...", "As a result, ...", "..., so they can..."],
        starterStructures: ["原因句 + , which / because + 结果"],
      };
    case "noun_pile":
      return {
        ...base,
        hintZh: "把名词堆叠拆成「主语 + 动词 + 具体信息」。",
        keywords:
          module === "example"
            ? ["practical skills", "work experience", "internships", "real projects"]
            : ["practical skills", "employability", "workplace skills"],
        phraseFragments: ["practical skills such as...", "through internships and projects"],
        starterStructures: ["Students need X, such as Y and Z."],
      };
    case "collocation":
      return {
        ...base,
        hintZh: "检查固定搭配与冠词（a/the）。",
        keywords: ["the employability", "a competitive advantage", "practical skills"],
        phraseFragments: ["improve their employability", "gain a competitive advantage"],
        starterStructures: [],
      };
    default:
      return {
        ...base,
        hintZh: "再读一遍，确保主语清楚、因果连贯。",
        keywords: ["because", "which", "therefore", "as a result"],
        phraseFragments: ["This is because...", "..., which means..."],
        starterStructures: [],
      };
  }
}

function buildDiagnosis(
  kind: SentenceProblemKind,
  priority: SentenceProblemPriority,
  labelZh: string,
  repairQuestionZh: string,
  module?: string,
): SentenceDiagnosis {
  const scaf = scaffoldingFor(kind, module);
  return {
    priority,
    kind,
    labelZh,
    repairQuestionZh,
    pass: false,
    ...scaf,
  };
}

/** 检测当前句最影响成立的单一结构问题（优先级 P1 > P2 > P3） */
export function diagnoseSentence(
  sentence: string,
  module?: string,
): SentenceDiagnosis {
  const s = sentence.trim();
  if (!s) {
    return buildDiagnosis(
      "missing_subject",
      "P1",
      "主语缺失",
      "这句话还缺一个明确的主语。谁在做这件事？",
      module,
    );
  }

  if (looksPassable(s)) {
    return {
      priority: "P3",
      kind: "none",
      labelZh: "可接受",
      repairQuestionZh: "",
      hintZh: "",
      keywords: [],
      phraseFragments: [],
      starterStructures: [],
      pass: true,
    };
  }

  if (detectMissingSubject(s)) {
    return buildDiagnosis(
      "missing_subject",
      "P1",
      "主语缺失",
      "谁在做这件事？请补一个明确主语（如 students / graduates / universities）。",
      module,
    );
  }
  if (detectBrokenWhich(s)) {
    return buildDiagnosis(
      "subject_verb_broken",
      "P1",
      "主谓/从句断裂",
      "「which」后面这部分，主语和动词是否配对了？哪一部分在修饰哪一部分？",
      module,
    );
  }
  if (detectClauseAttachment(s)) {
    return buildDiagnosis(
      "clause_attachment",
      "P1",
      "从句挂错",
      "「which」具体指代前面的哪一个名词？请把指代写清楚。",
      module,
    );
  }
  if (detectCauseEffectGap(s)) {
    return buildDiagnosis(
      "cause_effect_gap",
      "P1",
      "因果断裂",
      "实习/项目带来了什么结果？请用 which helps / as a result 等把因果连起来。",
      module,
    );
  }
  if (detectNounPile(s)) {
    return buildDiagnosis(
      "noun_pile",
      "P2",
      "中文式堆叠",
      "信息堆在一起了。请先分组：这是哪类技能/经历？它们之间是什么关系？",
      module,
    );
  }
  if (detectCollocation(s)) {
    return buildDiagnosis(
      "collocation",
      "P2",
      "搭配/冠词",
      "这里的名词搭配或冠词（a/the）可能需要调整。你想表达的是「一种优势」还是「他们的就业力」？",
      module,
    );
  }

  return buildDiagnosis(
    "unclear_wording",
    "P3",
    "表述不清",
    "这句话的主语和结果还不够清楚。读者能否一眼看出「谁」得到了「什么」？",
    module,
  );
}

export function stripBannedSentenceFeedback(text: string): string {
  let out = text;
  for (const p of [
    /your sentence has grammatical issues?\.?/gi,
    /grammar\s+issue[s]?\.?/gi,
    /awkward\s+sentence\.?/gi,
    /improve\s+clarity\.?/gi,
    /word\s+choice\.?/gi,
    /article\s+error[s]?\.?/gi,
    /tense\s+error[s]?\.?/gi,
  ]) {
    out = out.replace(p, "").trim();
  }
  return out;
}

export function formatSentenceCoachFeedback(
  diagnosis: SentenceDiagnosis,
  opts?: { pass?: boolean },
): string {
  if (opts?.pass || diagnosis.pass) {
    return "这句结构已经清楚，可以写入。请点击「确认写入」进入下一句。";
  }

  const block1 = [
    `【${diagnosis.priority} · ${diagnosis.labelZh}】`,
    diagnosis.repairQuestionZh,
  ].join("\n\n");

  const support: string[] = [];
  if (diagnosis.hintZh) support.push(diagnosis.hintZh);
  if (diagnosis.keywords.length) {
    support.push(`Keywords: ${diagnosis.keywords.join(" | ")}`);
  }
  if (diagnosis.phraseFragments.length) {
    support.push(`Patterns: ${diagnosis.phraseFragments.join(" / ")}`);
  }
  if (diagnosis.starterStructures.length) {
    support.push(`Starter: ${diagnosis.starterStructures.join(" / ")}`);
  }

  const block2 = support.join("\n");
  return block2 ? `${block1}\n\n${block2}` : block1;
}

const MODULE_LABEL_ZH: Record<string, string> = {
  claim: "立场句（Claim）",
  reason: "因果句（Reason）",
  example: "举例句（Example）",
  impact: "影响句（Impact）",
  conclusion_restate: "重申立场",
  conclusion_summary: "总结两段关系",
};

export function formatAssignPromptZh(
  module: string | undefined,
  moduleDirection: string,
): string {
  const label = MODULE_LABEL_ZH[module ?? ""] ?? "本句";
  const dir = moduleDirection?.trim();
  return [
    `请写一句英文：${label}。`,
    dir ? `本句功能：${dir}` : "",
    "一次只写一句；可参考下方 Keywords / Patterns。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function postProcessStage3Sentence(
  state: SessionState,
  result: LlmTurnResult,
  userMessage?: string,
): { result: LlmTurnResult; state: SessionState } {
  const s3 = state.s3;
  if (!s3 || state.subStep !== "S3_2_MODULE") {
    return { result, state };
  }

  const mod = getCurrentModule(s3.modulePlan, s3.currentBody, s3.moduleIndex);
  const varsDir = state.s3?.blueprint; // direction from buildVars - use module from state

  let next = { ...result };
  let nextState = state;

  if (next.verdict === "assign" || s3.mode === "assign") {
    const assignZh = formatAssignPromptZh(mod ?? undefined, getModuleDirection(state));
    const ls = next.languageSupport ?? {
      keywords: ["because", "which", "as a result", "therefore"],
      phraseFragments: ["This is because...", "..., which helps..."],
      starterStructures: [],
    };
    next = {
      ...next,
      verdict: "assign",
      userVisibleText: assignZh,
      languageSupport: ls,
      syntaxHint: undefined,
    };
    return {
      result: next,
      state: {
        ...nextState,
        s3: { ...s3, mode: "assign", pendingSentence: undefined },
      },
    };
  }

  const sentence = userMessage?.trim() ?? s3.pendingSentence?.trim() ?? "";
  if (!sentence) return { result: next, state: nextState };

  const diagnosis = diagnoseSentence(sentence, mod ?? undefined);
  const feedbackText = formatSentenceCoachFeedback(diagnosis);

  if (diagnosis.pass) {
    next = {
      ...next,
      verdict: "pass",
      advance: false,
      userVisibleText: feedbackText,
      moduleComplete: next.moduleComplete ?? true,
      mirror: undefined,
      coachQuestion: undefined,
      syntaxHint: undefined,
    };
    return {
      result: next,
      state: {
        ...nextState,
        s3: { ...s3, mode: "feedback", pendingSentence: sentence },
      },
    };
  }

  const cleaned = stripBannedSentenceFeedback(
    next.userVisibleText ?? next.coachQuestion ?? "",
  );
  const useLlm =
    cleaned.length > 12 &&
    !BANNED_FEEDBACK_RE.test(cleaned) &&
    !/grammar|awkward|clarity/i.test(cleaned);

  next = {
    ...next,
    verdict: "coach",
    advance: false,
    userVisibleText: useLlm ? `${feedbackText}\n\n${cleaned}`.slice(0, 900) : feedbackText,
    mirror: diagnosis.repairQuestionZh,
    coachQuestion: diagnosis.repairQuestionZh,
    languageSupport: {
      keywords: diagnosis.keywords,
      phraseFragments: diagnosis.phraseFragments,
      starterStructures: diagnosis.starterStructures,
    },
    moduleComplete: false,
    syntaxHint: undefined,
  };

  return {
    result: next,
    state: {
      ...nextState,
      s3: { ...s3, mode: "coach", pendingSentence: sentence },
      coachContext: {
        ...nextState.coachContext,
        lastQuestion: diagnosis.repairQuestionZh,
        openIssue: diagnosis.labelZh,
      },
    },
  };
}
