# Prompt 结构（流程规划 + 内容回应）

用户调优的全量规则已拆解接入，**未改写 Core Rules 与各 Stage 判定原文**。

## 拼接方式（每次 LLM 调用）

```
P0_flow.txt      ← 流程规划：阶段顺序、暗号、同轮切流、Stage3 流水线
P0_content.txt   ← 内容回应：Role、Core Rules 1–9、题目
P{1|2|3}_*.txt   ← 当前子步骤的内容判定与 JSON schema
```

由 `src/lib/prompts/loader.ts` → `buildFullPrompt()` 自动拼接。

## 文件对照

| 文件 | 对应原 Prompt |
|------|----------------|
| `P0_flow.txt` | Stage 触发、暗号、无缝切流、3.1→3.2 自动、Module 流水线 |
| `P0_content.txt` | Role、Target Topic、Core Rules 1–9 |
| `P1_stage1.txt` | Stage 1 审题判定 |
| `P1H` | Stage 1 审题定稿校验 |
| `P2_2` ~ `P2_3` | Stage 2 Body1/Body2 论证工作坊 |
| `P3_1` ~ `P3_3` | Stage 3 Blueprint / 逐句 / Body Check |

## 暗号

由**服务端**在 `verdict=pass` 时追加（`src/lib/orchestrator/transitions.ts`），与【流程规划】中「同轮切流」配合。

## 首轮开场白

固定句在 `src/lib/domain/constants.ts` → `STAGE1_OPENING`（与原文一致，不由 LLM 生成）。
