import type { SessionState, WorkshopBodyKey } from "./types";

const BODY1_EMPLOY_RE =
  /就业|工作技能|职场|实习|求职|招聘|上岗|coding|编程|项目|工程师|实践|雇主|技能训练/i;
const BODY2_ACADEMIC_RE =
  /学术|纯粹|知识|医学|理论|体系|深耕|研究|导师|论文|课程|领域|深造|科研|研究生|专业基础|底子|循序渐进/i;

const META_QUESTION_RE =
  /我先写|写什么|写啥|从哪写|怎么写|如何写|怎么开始|不知道从|还没写|要写什么/i;

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

export function detectChainMetaQuestion(message?: string): boolean {
  const m = message?.trim() ?? "";
  if (!m || m.length > 80) return false;
  return META_QUESTION_RE.test(m);
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
