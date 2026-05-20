import type { SessionState, WorkshopBodyKey } from "./types";

const BODY1_EMPLOY_RE =
  /就业|工作|工作技能|职场|实习|求职|招聘|上岗|coding|编程|项目|工程师|实践|雇主|技能训练|技术栈|计算机|公司|实用|岗位/i;
const BODY2_ACADEMIC_RE =
  /学术|纯粹|知识|医学|理论|体系|深耕|研究|导师|论文|课程|领域|深造|科研|研究生|专业基础|底子|循序渐进/i;

const META_QUESTION_RE =
  /我先写|写什么|写啥|从哪写|怎么写|如何写|怎么开始|不知道从|还没写|要写什么/i;

/** 对流程/审题定稿的疑问（不是 Reason/Example/Link 内容） */
const CHAIN_PROCESS_RE =
  /分论点.*(已经|给了|有了|可以|行吗|够|对吗)|论点.*(可以|行吗|够|对吗)|需要提供什么|需要写什么|要提供什么|你觉着.*分论点|你觉得.*分论点|claim.*(可以|够|吗)/i;

const COACH_COUNTER_QUESTION_RE =
  /为什么.*(还|要)|我不是.*(已经|都)|我这不是已经|还需要解释什么|什么意思|这是什么意思|你为什么这么问|为什么要我再|已经回答了|已经解释了/i;

const STAGE2_ENTRY_RE =
  /搭\s*Body1|论证链|工作技能为主|S2_2|一起搭/i;

/** Stage 2 起算点之后的用户消息（不含 Stage 1 审题探索） */
export function stage2UserMessages(state: SessionState): string[] {
  const history = state.chatHistory;
  let startIdx = 0;
  if (state.handoffLocked || state.stage >= 2) {
    for (let i = 0; i < history.length; i++) {
      const m = history[i];
      if (m.role === "assistant" && STAGE2_ENTRY_RE.test(m.content)) {
        startIdx = i + 1;
      }
    }
  }
  return history
    .slice(startIdx)
    .filter((m) => m.role === "user")
    .map((m) => m.content.trim())
    .filter(Boolean);
}

const CHAIN_FRUSTRATION_RE =
  /重复|问过了|说过|又问|别绕|怎么还问|已经回答|已经说/i;

export function detectChainFrustration(message?: string): boolean {
  return !!message?.trim() && CHAIN_FRUSTRATION_RE.test(message);
}

export function detectChainMetaQuestion(message?: string): boolean {
  const m = message?.trim() ?? "";
  if (!m || m.length > 80) return false;
  return META_QUESTION_RE.test(m);
}

export function detectChainProcessQuestion(message?: string): boolean {
  const m = message?.trim() ?? "";
  if (!m) return false;
  if (detectChainMetaQuestion(m)) return true;
  if (m.length > 120) return false;
  if (/比如说|例如|比如|医学生|因此|所以|因为/.test(m) && m.length > 40) {
    return false;
  }
  return CHAIN_PROCESS_RE.test(m);
}

/** 用户对教练流程提出反问/质疑：优先回答，不直接套模板 */
export function detectCoachCounterQuestion(message?: string): boolean {
  const m = message?.trim() ?? "";
  if (!m || m.length > 120) return false;
  return COACH_COUNTER_QUESTION_RE.test(m);
}

export function isMessageRelevantToBody(
  message: string,
  body: WorkshopBodyKey,
): boolean {
  const m = message.trim();
  if (m.length < 10) return false;
  if (META_QUESTION_RE.test(m)) return false;

  const employ = BODY1_EMPLOY_RE.test(m);
  const academic = BODY2_ACADEMIC_RE.test(m);

  if (body === "body1") {
    if (academic && !employ && /医学|理论基础|纯粹|体系化|循序渐进|专业理论|底子/.test(m)) {
      return false;
    }
    return employ;
  }

  if (academic && !employ) return true;
  if (employ && !academic) return false;
  return academic;
}

/** 当前 Body 工作坊：仅 Stage2 起 + 维度相关的用户话 */
export function userBlobForWorkshopBody(
  state: SessionState,
  body: WorkshopBodyKey,
): string {
  const seg = body === "body1" ? state.s2?.body1 : state.s2?.body2;
  const msgs = stage2UserMessages(state).filter((m) =>
    isMessageRelevantToBody(m, body),
  );
  return [seg?.draft?.trim() ?? "", ...msgs].filter(Boolean).join("\n");
}
