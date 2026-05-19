# 免费部署到 Vercel（Hobby）

部署后，**Gemini API 由 Vercel 国外机房发起**，本机不需要 VPN。

---

## 前提

- GitHub 账号（推荐）
- [Vercel](https://vercel.com) 账号（可用 GitHub 登录）
- 已有 **Google Gemini API Key**（[AI Studio](https://aistudio.google.com/apikey) 免费申请）

---

## 方式 A：用 GitHub + Vercel 网页（推荐）

### 1. 把代码推到 GitHub

在项目目录终端：

```bash
cd /Users/linwang/projects/ai-ielts-writing-tutor
git init
git add .
git commit -m "Initial commit for Vercel deploy"
```

在 GitHub 新建空仓库，然后：

```bash
git remote add origin https://github.com/你的用户名/ai-ielts-writing-tutor.git
git branch -M main
git push -u origin main
```

### 2. 导入 Vercel

1. 打开 https://vercel.com/new  
2. **Import** 你的 GitHub 仓库  
3. Framework 选 **Next.js**（自动识别）  
4. **不要改** Build Command / Output Directory  

### 3. 配置环境变量

在 Vercel 项目 → **Settings** → **Environment Variables**，添加：

| Name | Value |
|------|--------|
| `LLM_PROVIDER` | `gemini` |
| `GEMINI_API_KEY` | 你的 Google Gemini Key |
| `GEMINI_MODEL` | `gemini-2.5-flash` |
| `LLM_MOCK` | `false` |

**不要**在 Vercel 里填 `GEMINI_HTTPS_PROXY`（云端不需要代理）。

Environment 勾选 **Production**（Preview 也可一并勾选）。

### 4. 部署

点 **Deploy**，等 1–3 分钟。

成功后访问：`https://你的项目名.vercel.app`

- 首页：写作特训  
- 测试：https://你的项目名.vercel.app/test-llm  

---

## 方式 B：不用 GitHub，本机 Vercel CLI

```bash
npm i -g vercel
cd /Users/linwang/projects/ai-ielts-writing-tutor
vercel login
vercel
```

按提示选默认项。首次会问环境变量，可在网页后台补。

生产环境：

```bash
vercel --prod
```

---

## 部署后检查

1. 打开 `https://xxx.vercel.app/test-llm`  
2. **llm-test** 应为 `"ok": true`  
3. 首页选题 → **开始特训**，右侧应为真实 Gemini 回复（非 Mock）

---

## 常见问题

| 问题 | 处理 |
|------|------|
| Build 失败 | 本地先 `npm run build`，按报错修完再 push |
| `FUNCTION_INVOCATION_TIMEOUT` | Hobby 单次请求最长约 **10 秒**；可换 `gemini-2.5-flash`，或升级 Pro |
| 仍显示 Mock | Vercel 环境变量未填 / 未 redeploy |
| 502 / Gemini error | Key 无效或 Google 免费额度用尽 |

改环境变量后：Vercel → **Deployments** → 最新部署 ⋮ → **Redeploy**。

---

## 费用说明

- **Vercel Hobby**：个人项目免费额度通常够用  
- **Gemini API**：Google 免费档按量限制，见 AI Studio 用量页  

无需购买 OpenRouter。
