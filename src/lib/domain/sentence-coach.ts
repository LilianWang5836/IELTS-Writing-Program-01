/**
 * Stage 3 逐句写作：一次只修一个结构问题，反馈以中文修复问句为主。
 */
import { normalizeBlueprint } from "./blueprint-from-s2";
import { getCurrentModule } from "./module-compiler";
import { buildStage3OutputContract } from "./output-contract";
import { sampleStage3Task } from "./stage3-task-sampler";
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

export type SentenceProblemPriority = "P0" | "P1" | "P2" | "P3";

export type SentenceProblemKind =
  | "meaning_gap"
  | "missing_subject"
  | "missing_verb"
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

export interface MeaningAlignmentResult {
  aligned: boolean;
  missing: string[];
  requiredConcepts: string[];
}

export type Stage3SentenceIntent = "content" | "meta";
type DetectableProblemKind = Exclude<
  SentenceProblemKind,
  "none" | "unclear_wording" | "meaning_gap"
>;
type IssueLifecycle = NonNullable<SessionState["coachContext"]>["sentenceIssue"];
type IssueLedgerItem = NonNullable<
  NonNullable<SessionState["coachContext"]>["sentenceIssues"]
>[number];

/** 单轮只修一个问题（由前到后匹配） */
export const MAIN_ERROR_PRIORITY: Array<{
  priority: SentenceProblemPriority;
  kind: SentenceProblemKind;
}> = [
  { priority: "P1", kind: "missing_subject" },
  { priority: "P1", kind: "missing_verb" },
  { priority: "P1", kind: "subject_verb_broken" },
  { priority: "P1", kind: "clause_attachment" },
  { priority: "P1", kind: "cause_effect_gap" },
  { priority: "P2", kind: "collocation" },
  { priority: "P2", kind: "noun_pile" },
];

const ISSUE_PRIORITY_RANK: Record<SentenceProblemPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

const BANNED_FEEDBACK_RE =
  /grammar\s+issue|grammatical\s+issues?|awkward\s+sentence|improve\s+clarity|word\s+choice|article\s+error|tense\s+error/i;

const SUBJECT_STARTERS =
  /^(universities|university|students?|graduates?|they|it|this|these|those|the\s+\w+|many|some|people|employers|companies|governments?|job\s+seekers?|young\s+people)/i;

const CONCEPT_CUES: Record<string, string[]> = {
  job: ["job", "jobs", "work", "workplace", "employment", "employer", "career", "interview"],
  practice: ["practice", "practical", "intern", "internship", "project", "projects", "hands-on", "experience"],
  skill: ["skill", "skills", "technology", "technical", "language", "languages"],
  adapt: ["adapt", "adaptation", "fit", "transition", "ready"],
  academic: ["academic", "research", "knowledge", "theory", "study", "long-term"],
};

function detectOutlineConcepts(outline: string): string[] {
  const text = outline.trim();
  const concepts: string[] = [];
  if (/就业|求职|工作|职场|面试/.test(text)) concepts.push("job");
  if (/实践|实习|项目|动手/.test(text)) concepts.push("practice");
  if (/技能|技术|能力|语言/.test(text)) concepts.push("skill");
  if (/适应|上岗|过渡/.test(text)) concepts.push("adapt");
  if (/学术|研究|深造|知识|理论|长期/.test(text)) concepts.push("academic");
  return concepts;
}

function hasAnyCue(sentence: string, cues: string[]): boolean {
  const s = sentence.toLowerCase();
  return cues.some((c) => s.includes(c.toLowerCase()));
}

function moduleNeedsConnector(module?: string): boolean {
  return module === "reason" || module === "example";
}

function hasCauseOrContrast(sentence: string): boolean {
  return /\b(because|so|therefore|thus|as a result|which helps|which leads|while|but|however|instead|rather than|whereas)\b/i.test(
    sentence,
  );
}

export function assessMeaningAlignment(
  state: SessionState,
  sentence: string,
  module?: string,
): MeaningAlignmentResult {
  const s3 = state.s3;
  const body = s3?.currentBody;
  const s2 = state.s2;
  if (!s2 || !body || body === "conclusion") {
    return { aligned: true, missing: [], requiredConcepts: [] };
  }

  const bodyPoint = body === "body1" ? s2.body1Point : s2.body2Point;
  const bodyAngle = body === "body1" ? s2.body1Angle : s2.body2Angle;
  const outline = `${bodyPoint} ${bodyAngle}`.trim();
  const concepts = detectOutlineConcepts(outline);
  const required = concepts.slice(0, 3);
  const missing: string[] = [];

  const hasConcept = (c: string) => hasAnyCue(sentence, CONCEPT_CUES[c] ?? []);
  const hasScene = /\b(at school|in class|in companies|at work|in workplace|during internship|in internships?)\b/i.test(
    sentence,
  );
  const hasConnector = hasCauseOrContrast(sentence);

  // Sentence-level local function checks (not full-body completion).
  if (module === "example") {
    // Example: scene + realism/relevance, not final impact/closure.
    if (!hasScene) missing.push("example_scene");
    const hasDomainObject =
      required.some((c) => hasConcept(c)) ||
      /\b(school|class|company|companies|workplace|technology|language|languages)\b/i.test(
        sentence,
      );
    if (!hasDomainObject) missing.push("core_object");
    const hasRelevance =
      /\b(work|workplace|job|company|companies|employer|employers)\b/i.test(sentence) ||
      hasConnector;
    if (!hasRelevance) missing.push("claim_relevance");
    return {
      aligned: missing.length === 0,
      missing,
      requiredConcepts: required,
    };
  }

  if (module === "reason") {
    // Reason: cause-effect/contrast path + relevant object.
    const hasReasonObject = required.some((c) => hasConcept(c));
    if (!hasReasonObject) missing.push("core_object");
    if (!hasConnector) missing.push("logic_link");
    return {
      aligned: missing.length === 0,
      missing,
      requiredConcepts: required,
    };
  }

  if (module === "claim" || module === "conclusion_restate" || module === "conclusion_summary") {
    const hasClaimObject = required.some((c) => hasConcept(c));
    if (!hasClaimObject) missing.push("core_object");
    return {
      aligned: missing.length === 0,
      missing,
      requiredConcepts: required,
    };
  }

  // Fallback for unknown modules.
  for (const c of required) {
    if (!hasConcept(c)) {
      missing.push(c);
    }
  }

  if (moduleNeedsConnector(module) && !hasConnector) {
    missing.push("logic_link");
  }

  return {
    aligned: missing.length === 0,
    missing,
    requiredConcepts: required,
  };
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function hasFiniteVerb(s: string): boolean {
  return /\b(is|are|was|were|am|be|been|being|have|has|had|do|does|did|can|could|will|would|should|may|might|must|need|needs|help|helps|allow|allows|enable|enables|make|makes|improve|improves|lead|leads|provide|provides|offer|offers|give|gives|get|gets|become|becomes|join|joins)\b/i.test(
    s,
  );
}

function detectMissingSubject(s: string): boolean {
  // 形式主语句：it is + V-ed + that + 动作，但未出现明确执行者
  if (/^\s*it\s+is\s+[a-z]+ed\s+that\s+[a-z]+\b/i.test(s)) {
    return true;
  }
  if (SUBJECT_STARTERS.test(s)) return false;
  // 动名词短语可合法作主语：Mastering ... can help ...
  if (/^\s*[A-Za-z]+ing\s+/i.test(s) && hasFiniteVerb(s)) return false;
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

export function detectStage3SentenceIntent(message: string): Stage3SentenceIntent {
  const m = message.trim();
  if (!m) return "content";
  const metaRe =
    /(我觉得|我认为|不一定|能不能|可不可以|是不是|对吗|为什么|语法|主语|谓语|动名词|从句|搭配|这个表达|这样写|这句行吗|grammar|subject|predicate|gerund|clause)/i;
  const contentRe =
    /\b(for instance|for example|because|which|therefore|students?|graduates?|companies?|workplace|internships?|projects?)\b/i;
  if (metaRe.test(m) && !contentRe.test(m)) return "meta";
  if (metaRe.test(m) && /[？?]/.test(m)) return "meta";
  return "content";
}

function detectMissingVerb(s: string): boolean {
  if (hasFiniteVerb(s)) return false;
  const words = wordCount(s);
  if (words < 4) return false;
  // 有主语但无谓语时，优先判定为 missing verb
  if (SUBJECT_STARTERS.test(s)) return true;
  // 中文式名词堆叠也经常表现为无谓语
  if (
    /\b(students?|graduates?|universities|skills?|projects?|internships?|work experience)\b/i.test(
      s,
    )
  ) {
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
  const normalized = s.toLowerCase().replace(/[^a-z\s]/g, " ");
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const nounLike = (w: string): boolean =>
    /^(skills?|knowledge|experience|experiences|projects?|internships?|work|workplace|jobs?|career|market|needs?)$/.test(
      w,
    ) || /(tion|ment|ness|ity|ship|ance|ence)s?$/.test(w);
  const breaker = (w: string): boolean =>
    /^(and|or|with|through|by|for|to|at|in|on|from|that|which|who|because|therefore|thus|so|as|while|but)$/.test(
      w,
    );

  let run = 0;
  for (const t of tokens) {
    if (nounLike(t)) {
      run += 1;
      if (run >= 3) return true;
      continue;
    }
    if (breaker(t)) {
      run = 0;
      continue;
    }
    run = 0;
  }

  if (wordCount(s) >= 8 && !hasFiniteVerb(s)) return true;
  return false;
}

function buildDetectorMap(s: string): Record<DetectableProblemKind, () => boolean> {
  return {
    missing_subject: () => detectMissingSubject(s),
    missing_verb: () => detectMissingVerb(s),
    subject_verb_broken: () => detectBrokenWhich(s),
    clause_attachment: () => detectClauseAttachment(s),
    cause_effect_gap: () => detectCauseEffectGap(s),
    collocation: () => detectCollocation(s),
    noun_pile: () => detectNounPile(s),
  };
}

const DIAGNOSTIC_META: Record<
  DetectableProblemKind,
  { label: string; q: string }
> = {
  missing_subject: {
    label: "主语缺失",
    q: "现在看不出来“谁”在做这个动作。先明确主语是谁？",
  },
  missing_verb: {
    label: "缺少核心谓语",
    q: "这句话有信息，但缺少核心动作。谁在做什么？",
  },
  subject_verb_broken: {
    label: "主谓/从句断裂",
    q: "「which」后面的主语和动词没配上。你要表达的动作是什么？",
  },
  clause_attachment: {
    label: "从句挂错",
    q: "这里的从句指代不清。`which` 具体指前面的哪一部分？",
  },
  cause_effect_gap: {
    label: "因果断裂",
    q: "原因和结果还没连起来。这会导致什么结果？",
  },
  collocation: {
    label: "搭配/冠词",
    q: "这里有一个小搭配问题。先想想这个名词前需要什么限定词？",
  },
  noun_pile: {
    label: "中文式堆叠",
    q: "现在词组堆在一起了。先分出：动作、经历、结果各是哪一块？",
  },
};

function buildDiagnosisFromKind(
  kind: DetectableProblemKind,
  module?: string,
): SentenceDiagnosis {
  const step = MAIN_ERROR_PRIORITY.find((s) => s.kind === kind);
  const priority = (step?.priority ?? "P3") as SentenceProblemPriority;
  const meta = DIAGNOSTIC_META[kind];
  return buildDiagnosis(kind, priority, meta.label, meta.q, module);
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
    case "meaning_gap":
      return {
        ...base,
        hintZh: "先把核心中文逻辑说完整，再做语法细修。",
        keywords: ["contrast", "result", "workplace", "internship"],
        phraseFragments: ["X at school, but Y at work", "..., which helps ..."],
        starterStructures: ["先保留核心对比 + 再补结果"],
      };
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
    case "missing_verb":
      return {
        ...base,
        hintZh: "先把动作动词补出来，再接结果。",
        keywords: ["need", "help", "improve", "lead to"],
        phraseFragments: ["Students need...", "... helps them ..."],
        starterStructures: ["主语 + 动词 + 结果"],
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

function dedupeKeepOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of items) {
    const key = i.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(i.trim());
  }
  return out;
}

function extractStudentKeywords(sentence: string): string[] {
  const s = sentence.toLowerCase();
  const picks: string[] = [];
  const rules: Array<[RegExp, string]> = [
    [/\bwork needs?\b/, "work needs"],
    [/\bjob market\b/, "job market"],
    [/\bcompetitive (edge|advantage)\b/, "competitive edge"],
    [/\bintern experiences?\b/, "intern experiences"],
    [/\binternships?\b/, "internships"],
    [/\bprojects?\b/, "projects"],
    [/\bskills?\b/, "skills"],
    [/\bexperience\b/, "experience"],
  ];
  for (const [re, keyword] of rules) {
    if (re.test(s)) picks.push(keyword);
  }
  return dedupeKeepOrder(picks);
}

function buildAnchoredFragments(
  sentence: string,
  kind: SentenceProblemKind,
): { keywords: string[]; phraseFragments: string[]; starterStructures: string[] } {
  const words = extractStudentKeywords(sentence);
  const has = (w: string) => words.includes(w);
  const skillWord = has("skills") ? "skills" : "";
  const projectWord = has("projects") ? "projects" : "";
  const internWord = has("intern experiences")
    ? "intern experiences"
    : has("internships")
      ? "internships"
      : "";
  const marketWord = has("job market") ? "job market" : "";
  const workNeedsWord = has("work needs") ? "work needs" : "";

  if (kind === "noun_pile") {
    const keywords = words.slice(0, 4);
    const phraseFragments: string[] = [];
    if (skillWord) {
      phraseFragments.push(
        `${skillWord} needed for ${workNeedsWord || marketWord || "..."}`,
      );
    }
    if (projectWord || internWord) {
      const exp = [projectWord, internWord].filter(Boolean).join(" and ");
      phraseFragments.push(`experience such as ${exp || "..."}`);
    }
    if (marketWord) {
      phraseFragments.push(`... in the ${marketWord}`);
    }
    return {
      keywords: keywords.length ? keywords : ["skills", "projects", "experience"],
      phraseFragments: phraseFragments.slice(0, 2),
      starterStructures: ["X skills + Y experience + result in ..."],
    };
  }

  if (kind === "cause_effect_gap") {
    const keywords = dedupeKeepOrder([
      ...words.slice(0, 3),
      "which helps",
      "as a result",
    ]).slice(0, 4);
    return {
      keywords,
      phraseFragments: [
        `${projectWord || internWord || "this"} ... , which helps ...`,
        `as a result, ... ${marketWord ? `in the ${marketWord}` : ""}`.trim(),
      ],
      starterStructures: [],
    };
  }

  if (kind === "missing_subject" || kind === "missing_verb") {
    if (kind === "missing_subject") {
      const keywords = ["students", "graduates", "young people"];
      const phraseFragments = [
        "students who ...",
        "graduates with ...",
        "people who have ...",
      ];
      if (has("intern experiences") || has("internships")) {
        phraseFragments.push("graduates who have intern experience ...");
      }
      return {
        keywords,
        phraseFragments: phraseFragments.slice(0, 3),
        starterStructures: ["明确主语 + 动词 + 结果"],
      };
    }
    return {
      keywords: dedupeKeepOrder([...words.slice(0, 2), "students", "graduates"]).slice(
        0,
        4,
      ),
      phraseFragments: ["Students ...", "Graduates ..."],
      starterStructures: ["Subject + Verb + Result"],
    };
  }

  return { keywords: [], phraseFragments: [], starterStructures: [] };
}

export function applyStudentAnchoredScaffolding(
  diagnosis: SentenceDiagnosis,
  sentence: string,
): SentenceDiagnosis {
  const anchored = buildAnchoredFragments(sentence, diagnosis.kind);
  const keywords = anchored.keywords.length ? anchored.keywords : diagnosis.keywords;
  const phraseFragments = anchored.phraseFragments.length
    ? anchored.phraseFragments
    : diagnosis.phraseFragments;
  const starterStructures = anchored.starterStructures.length
    ? anchored.starterStructures
    : diagnosis.starterStructures;
  return {
    ...diagnosis,
    repairQuestionZh: diagnosis.repairQuestionZh,
    keywords: keywords.slice(0, 4),
    phraseFragments: phraseFragments.slice(0, 2),
    starterStructures: starterStructures.slice(0, 1),
  };
}

function locateProblemSnippet(
  sentence: string,
  diagnosis: SentenceDiagnosis,
): string {
  const s = sentence.trim();
  if (!s) return "";
  const low = s.toLowerCase();

  if (diagnosis.kind === "meaning_gap") {
    return s.split(/[,;，；]/)[0]?.trim() ?? s.slice(0, 28);
  }

  if (diagnosis.kind === "missing_subject") {
    const afterThat = s.match(/\bthat\s+([^,.;，；]+)/i)?.[1]?.trim();
    if (afterThat) return afterThat.split(/\s+/).slice(0, 6).join(" ");
    return s.split(/[,;，；]/)[0]?.trim() ?? s.slice(0, 28);
  }

  if (diagnosis.kind === "missing_verb") {
    return s.split(/[,;，；]/)[0]?.trim() ?? s.slice(0, 28);
  }

  if (diagnosis.kind === "subject_verb_broken" || diagnosis.kind === "clause_attachment") {
    const whichChunk = s.match(/\bwhich\b[^,.;，；]{0,40}/i)?.[0];
    if (whichChunk) return whichChunk.trim();
  }

  if (diagnosis.kind === "cause_effect_gap") {
    const causeChunk = s.split(/[,;，；]/).map((x) => x.trim())[0];
    if (causeChunk) return causeChunk;
  }

  if (diagnosis.kind === "noun_pile") {
    const nounPile = s.match(
      /\b[a-z]+(?:\s+[a-z]+){1,4}\b/i,
    )?.[0];
    if (nounPile) return nounPile;
  }

  if (diagnosis.kind === "collocation") {
    const articleChunk = s.match(/\b(a|an)\s+[a-z]+\b/i)?.[0];
    if (articleChunk) return articleChunk;
  }

  const fromKeywords = diagnosis.keywords.find((k) => low.includes(k.toLowerCase()));
  if (fromKeywords) return fromKeywords;
  return s.split(/[,;，；]/)[0]?.trim() ?? s.slice(0, 28);
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

  const detector = buildDetectorMap(s);

  for (const step of MAIN_ERROR_PRIORITY) {
    const kind = step.kind as DetectableProblemKind;
    const probe = detector[kind];
    if (!probe || !probe()) continue;
    return buildDiagnosisFromKind(kind, module);
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
  sentence?: string,
  opts?: { pass?: boolean },
): string {
  if (opts?.pass || diagnosis.pass) {
    return "这句结构已经清楚，可以写入。请点击「确认写入」进入下一句。";
  }

  const snippet = locateProblemSnippet(sentence ?? "", diagnosis);
  const block1 = [
    `【${diagnosis.priority} · ${diagnosis.labelZh}】`,
    snippet ? `问题位置：${snippet}` : "",
    diagnosis.repairQuestionZh,
  ]
    .filter(Boolean)
    .join("\n\n");

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

function getOrchestratorLayerHint(state: SessionState): string {
  const o = state.s3?.orchestrator;
  if (!o || o.focusLayer === "sentence") return "";
  if (o.focusLayer === "essay") {
    return "【Orchestrator建议：先修全局一致性】先确保该句不偏离整篇主论点，再做句内优化。";
  }
  return "【Orchestrator建议：先修段内角色】先让这句明确完成当前段功能，再做词法细修。";
}

function prependHint(hint: string, text: string): string {
  if (!hint.trim()) return text;
  if (!text.trim()) return hint;
  return `${hint}\n\n${text}`;
}

function resolveIssueLifecycle(
  prev: IssueLifecycle | undefined,
  diagnosis: SentenceDiagnosis,
  sentence: string,
): NonNullable<IssueLifecycle> {
  if (diagnosis.pass) {
    return {
      kind: diagnosis.kind,
      status: "resolved",
      lastSnippet: "",
      consecutiveTurns: 0,
    };
  }

  const snippet = locateProblemSnippet(sentence, diagnosis);
  const nextTurns =
    prev?.kind === diagnosis.kind ? (prev?.consecutiveTurns ?? 0) + 1 : 1;
  if (!prev?.kind) {
    return {
      kind: diagnosis.kind,
      status: "active",
      lastSnippet: snippet,
      consecutiveTurns: nextTurns,
    };
  }
  if (prev.status === "resolved" && diagnosis.kind !== "none") {
    return {
      kind: diagnosis.kind,
      status: "regressed",
      lastSnippet: snippet,
      consecutiveTurns: nextTurns,
    };
  }
  if (prev.kind !== diagnosis.kind) {
    return {
      kind: diagnosis.kind,
      status: "improving",
      lastSnippet: snippet,
      consecutiveTurns: nextTurns,
    };
  }
  if (
    prev.lastSnippet &&
    snippet &&
    prev.lastSnippet.trim().toLowerCase() !== snippet.trim().toLowerCase()
  ) {
    return {
      kind: diagnosis.kind,
      status: "improving",
      lastSnippet: snippet,
      consecutiveTurns: nextTurns,
    };
  }
  if (nextTurns >= 3) {
    return {
      kind: diagnosis.kind,
      status: "regressed",
      lastSnippet: snippet,
      consecutiveTurns: nextTurns,
    };
  }
  return {
    kind: diagnosis.kind,
    status: "active",
    lastSnippet: snippet,
    consecutiveTurns: nextTurns,
  };
}

function applyLifecycleHint(
  feedback: string,
  lifecycle: IssueLifecycle | undefined,
): string {
  if (!lifecycle) return feedback;
  if (lifecycle.status === "improving") {
    return `进展：比上一版更接近目标，当前只改这一处。\n\n${feedback}`;
  }
  if (lifecycle.status === "regressed") {
    return `进展：这一类问题连续出现，我们改成更小步只修一个片段。\n\n${feedback}`;
  }
  return feedback;
}

function updateIssueLedger(
  prevItems: IssueLedgerItem[] | undefined,
  diagnosis: SentenceDiagnosis,
  sentence: string,
): IssueLedgerItem[] {
  const prev = Array.isArray(prevItems) ? prevItems : [];
  if (diagnosis.pass) {
    return prev
      .map((it) => ({ ...it, status: "resolved" as const, consecutiveTurns: 0 }))
      .sort(
        (a, b) =>
          ISSUE_PRIORITY_RANK[a.priority] - ISSUE_PRIORITY_RANK[b.priority] ||
          b.hits - a.hits,
      );
  }

  const snippet = locateProblemSnippet(sentence, diagnosis);
  const found = prev.find((it) => it.kind === diagnosis.kind);
  const nextTurns = found ? found.consecutiveTurns + 1 : 1;
  const status: IssueLedgerItem["status"] = !found
    ? "active"
    : found.lastSnippet &&
        snippet &&
        found.lastSnippet.trim().toLowerCase() !== snippet.trim().toLowerCase()
      ? "improving"
      : nextTurns >= 3
        ? "regressed"
        : "active";

  const currentItem: IssueLedgerItem = {
    kind: diagnosis.kind,
    priority: diagnosis.priority,
    status,
    lastSnippet: snippet,
    hits: (found?.hits ?? 0) + 1,
    consecutiveTurns: nextTurns,
  };

  const currentRank = ISSUE_PRIORITY_RANK[diagnosis.priority];
  const updatedOthers = prev
    .filter((it) => it.kind !== diagnosis.kind)
    .map((it) => {
      if (it.status === "resolved") return it;
      const rank = ISSUE_PRIORITY_RANK[it.priority];
      if (rank > currentRank) {
        return { ...it, status: "improving" as const, consecutiveTurns: 0 };
      }
      return it;
    });

  return [currentItem, ...updatedOthers].sort(
    (a, b) =>
      (a.status === "resolved" ? 1 : 0) - (b.status === "resolved" ? 1 : 0) ||
      ISSUE_PRIORITY_RANK[a.priority] - ISSUE_PRIORITY_RANK[b.priority] ||
      b.hits - a.hits,
  );
}

function chooseFocusKind(
  current: SentenceDiagnosis,
  items: IssueLedgerItem[],
  detector: Record<DetectableProblemKind, () => boolean>,
): DetectableProblemKind | null {
  if (current.pass) return null;
  const currentKind = current.kind as DetectableProblemKind;
  const currentRank = ISSUE_PRIORITY_RANK[current.priority];
  const candidate = items.find((it) => {
    const kind = it.kind as DetectableProblemKind;
    const probe = detector[kind];
    if (!probe) return false;
    if (it.status === "resolved" || !probe()) return false;
    return ISSUE_PRIORITY_RANK[it.priority] <= currentRank;
  });
  if (!candidate) return currentKind;
  return candidate.kind as DetectableProblemKind;
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

  const sampledTask = sampleStage3Task(state);
  const mod = sampledTask?.taskType ?? null;
  const orchestrator = s3.orchestrator;
  const layerHint = getOrchestratorLayerHint(state);

  let next = { ...result };
  let nextState = state;

  if (next.verdict === "assign" || s3.mode === "assign") {
    const assignZh = formatAssignPromptZh(
      mod ?? undefined,
      getModuleDirection(state),
    );
    const ls = next.languageSupport ?? {
      keywords: ["because", "which", "as a result", "therefore"],
      phraseFragments: ["This is because...", "..., which helps..."],
      starterStructures: [],
    };
    const feedbackBody =
      orchestrator?.mode === "soft"
        ? prependHint(layerHint, assignZh)
        : assignZh;
    next = {
      ...next,
      verdict: "assign",
      userVisibleText: buildStage3OutputContract({
        module: mod ?? null,
        meaningOk: true,
        meaningReason: "当前为任务布置轮",
        paragraphFit: true,
        paragraphReason: "先按当前模块产出一版句子",
        feedback: feedbackBody,
        suggestedRevision: "先写一句英文草稿（不必一次完美）。",
        nextStep: "提交你的句子后，我会先看 meaning 与结构，再做细修。",
        orchestrator,
      }),
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
  const prevIssue = nextState.coachContext?.sentenceIssue;
  const prevIssues = nextState.coachContext?.sentenceIssues;

  const intent = detectStage3SentenceIntent(sentence);
  if (intent === "meta") {
    const clarification =
      /动名词|gerund|主语/.test(sentence)
        ? "你说得对，动名词短语可以做主语，不一定必须换成人称主语。这里更该修的是搭配和连接。"
        : "这是一个表达/语法层面的讨论点，我们先澄清判断，再继续修句。";
    next = {
      ...next,
      verdict: "coach",
      advance: false,
      userVisibleText: buildStage3OutputContract({
        module: mod ?? null,
        meaningOk: true,
        meaningReason: "当前是表达讨论，不是内容偏题",
        paragraphFit: true,
        paragraphReason: "先澄清语法选择，再回到当前句",
        feedback: prependHint(
          layerHint,
          `${clarification}\n\n请在保留原意的前提下，再发一版英文句子。`,
        ),
        suggestedRevision: "基于你原句改一版，不需要整句重写。",
        nextStep: "继续提交英文句子，我会回到当前模块修句。",
        orchestrator,
      }),
      mirror: clarification,
      coachQuestion: "继续改原句即可，不需要整句重写。",
      moduleComplete: false,
      syntaxHint: undefined,
    };
    return {
      result: next,
      state: {
        ...nextState,
        s3: { ...s3, mode: "coach", pendingSentence: s3.pendingSentence },
        coachContext: {
          ...nextState.coachContext,
          lastQuestion: next.coachQuestion,
          openIssue: "表达讨论（meta）",
          sentenceIssue: prevIssue,
          sentenceIssues: prevIssues,
        },
      },
    };
  }

  // Phase 2 minimal takeover: only hard-block essay contradiction.
  if (
    orchestrator?.mode === "hard" &&
    (
      (orchestrator.focusLayer === "essay" && orchestrator.essayContradiction) ||
      (orchestrator.focusLayer === "paragraph" && orchestrator.paragraphDrift)
    )
  ) {
    const hardGuide =
      orchestrator.focusLayer === "essay"
        ? "先修全篇一致性：当前存在论点冲突，先统一整篇方向，再做句内语法与词汇细修。"
        : "先修段内角色一致性：当前句偏离本段功能，先补回该段应有的逻辑作用，再做句内细修。";
    next = {
      ...next,
      verdict: "coach",
      advance: false,
      userVisibleText: buildStage3OutputContract({
        module: mod ?? null,
        meaningOk: false,
        meaningReason: "优先处理更高层矛盾",
        paragraphFit: orchestrator.focusLayer !== "paragraph",
        paragraphReason:
          orchestrator.focusLayer === "essay"
            ? "先修全篇一致性"
            : "先修段内角色一致性",
        feedback: prependHint(layerHint, hardGuide),
        suggestedRevision:
          orchestrator.focusLayer === "essay"
            ? "先写一句与总论点同向的句子。"
            : "先写一句明确承担当前段功能的句子。",
        nextStep: "先完成上层修复，再进入句内细修。",
        orchestrator,
      }),
      mirror: hardGuide,
      coachQuestion: "按这个方向改一版，再进入句内细修。",
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
          lastQuestion: next.coachQuestion,
          openIssue: `Orchestrator(${orchestrator.focusLayer})`,
          sentenceIssue: prevIssue,
          sentenceIssues: prevIssues,
        },
      },
    };
  }

  const meaning = assessMeaningAlignment(state, sentence, mod ?? undefined);
  if (!meaning.aligned) {
    const missingLabels = meaning.missing
      .map((m) =>
        m === "job"
          ? "求职/工作相关对象"
          : m === "practice"
            ? "实践/实习对象"
            : m === "skill"
              ? "技能/技术对象"
              : m === "adapt"
                ? "适应工作相关对象"
                : m === "academic"
                  ? "学术/研究对象"
                  : m === "logic_link"
                    ? "因果/对比连接"
                    : m === "example_scene"
                      ? "具体场景"
                      : m === "claim_relevance"
                        ? "与论点关联"
                        : "核心对象",
      )
      .join("、");

    const meaningDiagnosis = applyStudentAnchoredScaffolding(
      buildDiagnosis(
        "meaning_gap",
        "P0",
        "Meaning 未对齐",
        `这句还没完整表达既定中文逻辑，当前缺：${missingLabels}。先把这些意思补全。`,
        mod ?? undefined,
      ),
      sentence,
    );

    const meaningLifecycle = resolveIssueLifecycle(
      prevIssue,
      meaningDiagnosis,
      sentence,
    );
    const meaningIssues = updateIssueLedger(prevIssues, meaningDiagnosis, sentence);
    const feedbackText = applyLifecycleHint(
      formatSentenceCoachFeedback(meaningDiagnosis, sentence),
      meaningLifecycle,
    );
    const feedbackBody =
      orchestrator?.mode === "soft"
        ? prependHint(layerHint, feedbackText)
        : feedbackText;
    next = {
      ...next,
      verdict: "coach",
      advance: false,
      userVisibleText: buildStage3OutputContract({
        module: mod ?? null,
        meaningOk: false,
        meaningReason: `缺失：${missingLabels}`,
        paragraphFit: false,
        paragraphReason: "当前句未完成本模块局部功能",
        feedback: feedbackBody,
        suggestedRevision:
          meaningDiagnosis.phraseFragments[0] ?? "先补齐缺失 meaning，再微调语法。",
        nextStep: "补齐上述 meaning 后再发一版句子。",
        orchestrator,
      }),
      mirror: meaningDiagnosis.repairQuestionZh,
      coachQuestion: meaningDiagnosis.repairQuestionZh,
      languageSupport: {
        keywords: meaningDiagnosis.keywords,
        phraseFragments: meaningDiagnosis.phraseFragments,
        starterStructures: meaningDiagnosis.starterStructures,
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
          lastQuestion: meaningDiagnosis.repairQuestionZh,
          openIssue: "Meaning 未对齐",
          sentenceIssue: meaningLifecycle,
          sentenceIssues: meaningIssues,
        },
      },
    };
  }

  const diagnosisRaw = diagnoseSentence(sentence, mod ?? undefined);
  const detectorMap = buildDetectorMap(sentence);
  const tentativeIssues = updateIssueLedger(prevIssues, diagnosisRaw, sentence);
  const focusKind = chooseFocusKind(diagnosisRaw, tentativeIssues, detectorMap);
  const focusedRaw =
    focusKind && focusKind !== diagnosisRaw.kind
      ? buildDiagnosisFromKind(focusKind, mod ?? undefined)
      : diagnosisRaw;
  const diagnosis = applyStudentAnchoredScaffolding(focusedRaw, sentence);
  const issues = updateIssueLedger(prevIssues, focusedRaw, sentence);
  const lifecycle = resolveIssueLifecycle(prevIssue, diagnosis, sentence);
  const feedbackText = applyLifecycleHint(
    formatSentenceCoachFeedback(diagnosis, sentence),
    lifecycle,
  );

  if (diagnosis.pass) {
    const passText = "这句结构已经清楚，可以写入。请点击「确认写入」进入下一句。";
    next = {
      ...next,
      verdict: "pass",
      advance: false,
      userVisibleText: buildStage3OutputContract({
        module: mod ?? null,
        meaningOk: true,
        meaningReason: "已覆盖当前句目标含义",
        paragraphFit: true,
        paragraphReason: "句子功能与当前模块匹配",
        feedback: passText,
        suggestedRevision: "保持此框架，后续只做词汇/语法微调。",
        nextStep: "点击确认写入，进入下一句。",
        orchestrator,
      }),
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
        coachContext: {
          ...nextState.coachContext,
          sentenceIssue: lifecycle,
          sentenceIssues: issues,
        },
      },
    };
  }

  next = {
    ...next,
    verdict: "coach",
    advance: false,
    userVisibleText: buildStage3OutputContract({
      module: mod ?? null,
      meaningOk: true,
      meaningReason: "核心含义可理解，进入结构/表达修复",
      paragraphFit: true,
      paragraphReason: "当前句仍在本模块范围内",
      feedback:
        orchestrator?.mode === "soft"
          ? prependHint(layerHint, feedbackText)
          : feedbackText,
      suggestedRevision:
        diagnosis.phraseFragments[0] ?? "按反馈只改一个问题，再发一版。",
      nextStep: "保留原意，修改这一处后提交。",
      orchestrator,
    }),
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
        sentenceIssue: lifecycle,
        sentenceIssues: issues,
      },
    },
  };
}
