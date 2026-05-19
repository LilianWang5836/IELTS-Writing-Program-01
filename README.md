# AI IELTS Writing Tutor (MVP)

基于三阶段特训流程的雅思 Task 2 写作教练：**Stage 1 审题立意 → Stage 2 主体段因果金字塔 → Stage 3 逐句写作**。

## 功能

- 双栏界面：左侧写作区（论点 / 成稿汇总），右侧 AI 教练对话
- 模块化 Prompt 编排（`prompts/` + `src/lib/orchestrator/`）
- 阶段暗号由服务端追加（`[STAGE_1_PASS]` 等）
- 支持 **Google Gemini** / **OpenAI**；未配置 API Key 时自动 **Mock**

## 快速开始

```bash
cd /Users/linwang/projects/ai-ielts-writing-tutor
npm install
cp .env.example .env.local   # 填入 GEMINI_API_KEY 或 OPENAI_API_KEY
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)

**本机连不上 Google？** 可免费部署到 Vercel，由云端调 Gemini → 见 [DEPLOY.md](./DEPLOY.md)

1. 选择题目 → **开始特训**
2. 按右侧教练引导依次完成 Stage 1–3
3. Stage 3 句子被认可后点击 **确认写入**，内容汇总到左侧

## 环境变量

### Gemini（推荐）

在 [Google AI Studio](https://aistudio.google.com/apikey) 创建 API Key，写入 `.env.local`：

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=你的密钥
GEMINI_MODEL=gemini-2.0-flash
```

重启 `npm run dev` 后生效。也可访问 `GET /api/config` 查看当前是 `mock` 还是 `live`。

### OpenAI（可选）

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

### 其他

| 变量 | 说明 |
|------|------|
| `LLM_PROVIDER` | `gemini` 或 `openai`；不填则按 Key 自动选择 |
| `LLM_MOCK=true` | 强制 Mock，不调用任何 API |

## 项目结构

```
prompts/           # P0–P3 模块化 prompt 文本
src/lib/domain/    # 状态机、校验、模块编译
src/lib/orchestrator/  # 回合编排、阶段转移
src/lib/llm/       # LLM 客户端 + Mock
src/app/api/       # POST /api/chat, GET /api/questions
src/components/    # 双栏 UI
```

## API

### `POST /api/chat`

```json
{ "action": "init", "questionId": "q1" }
```

```json
{ "action": "turn", "message": "...", "state": { ... } }
```

```json
{ "action": "confirm", "state": { ... } }
```

Stage 3 在 feedback 通过后使用 `confirm` 将句子写入左侧。

## 说明

- MVP 未做用户账号与数据库，状态保存在浏览器 `localStorage`
- 生产环境请配置真实 LLM 并调优 `prompts/` 内容
- 暗号与阶段切换逻辑见 `src/lib/orchestrator/transitions.ts`
