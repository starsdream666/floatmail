# clef 判定接入文档 — 作为 jev 判定环节的免费替代

## 项目接入与能力校正（2026-10-30）

本文下方保留早期接口探测记录，实际项目以此节及当前实现为准。

- 「AI 配置」独立标签页集中管理邮件翻译、API 来源、提取方式与判定模型，使用「保存 AI 配置」独立校验、保存；通用设置使用自己的保存入口。提取方式支持「本地规则 + AI 补充」「仅 AI」「AI 提取 + JEV / Clef 判定」；判定模型支持「关闭 / JEV / Clef」。
- 翻译 API、提取 API、JEV 均有独立连接测试按钮；Clef 可单独测试某个账号或测试全部账号。测试直接读取未保存的输入值，发送固定短样例，不保存配置、不读取真实邮件。JEV 各 Key、Clef 各绑定分别请求一次，不使用自动轮换掩盖失败；显示耗时与脱敏错误。修改配置后旧测试提示失效。测试验证接口与响应协议可用，不代表真实邮件提取准确率。
- 「仅 AI」隐藏判定设置，跳过正则候选和所有判定模型；「AI + 判定」只把 AI 候选送去判定。两者均保留原文校验，AI 失败不会回落正则。
- 默认保持原有混合提取行为；旧 `jevEnabled` 配置兼容迁移。`mailInsightApiMode=none` 配合混合方式可继续使用「仅正则」或「正则 + 判定」。
- Clef 使用 `popup-modules/clef-insight.js`，在「AI 配置」页通过「添加账号」绑定每组 Account ID 与 API Token，可填写备注或删除账号。模型统一选择 `clef` 或 `clef-flash`，直连官方 REST，显式传入与 URL 一致的 `model`，不走 AI Gateway。
- 判定以验证码候选的 `choice + none`、每条链接的 `noul` 为主；同时询问 `otp`、`magic`、`extort`。不使用 `kind.choice` 作最终结论，整封概率不能创造原文中不存在的候选。
- 验证码 `choice.confidence < 0.5`、链接概率在 `(0.35, 0.6)` 时标记为未知，并保留未确认的参考结果；不自动调用收费 JEV。`extort >= 0.8` 时隐藏本次可操作结果并提示索码风险，不删除邮件。
- 账号池保存在 `clefAccounts`，每项为 `{id, name, accountId, apiToken}`。轮换时 URL 中的 Account ID 与 Authorization 中的 Key 一起切换，绝不跨记录混用。旧的单 ID、多行 Key 配置会迁移为绑定同一 ID 的多条记录；保存新配置后清空旧字段，显式空账号池不会恢复旧 Key。
- 每次判定随机首选一组；鉴权失败、网络异常、无效响应、429/5xx 会换用未尝试过的组，总共最多请求四次；400/422 等请求体错误不轮换。仅一组时保留 429/5xx 最多三次退避重试。
- 设置页在对应账号下显示最近一次调用成功或失败；完整失败结果携带账号备注、Account ID 与错误信息，不携带 Key。失败后换组成功仍保留先前账号的失败状态，编辑凭据后忽略旧在途请求的状态更新。状态仅在当前面板会话中显示。
- 请求失败保留 AI 结果或混合方式下的本地结果。账号池支持本地保存、导入导出、后台 storage 代理和跨面板同步；默认导出逐项脱敏 Token 并保留账号信息，导入含脱敏 Key 的池时跳过整个池，保留当前真实绑定。仓库不保存用户提供的真实凭据。

**能力校正：**当前 `images` 支持嵌入 base64 图片。实测 PNG 可用于从给定候选中选出图上的验证码；`assets`、远程图片 URL、`box` 与自由文本提取类型仍被拒绝。下文「不支持图片」应理解为旧 `assets` 形式不支持。本次项目接入保持文本流程，没有新增图片抓取或 OCR 提取。

**不能保证逐位快照：**同一 payload 重复请求曾观测到一致输出，但不同问题集会改变概率，服务端模型也可能更新。第 11 节数值仅作为历史记录，不应直接作为线上 API 的永久逐位断言。

官方接口：[Clef](https://developers.cloudflare.com/workers-ai/models/clef/)。回归检查：`node --test tests/*.test.cjs`。

---

> 读者：负责改造流水线的 AI / 工程师。
> 任务边界：**只新增 clef 判定实现，不改动已有的正则提取、AI 二次提取、jev 判定代码**。命中文档中的接口契约即可接入。
> 目标形态：`正则提取 → [clef 判定]` 或 `正则提取 → AI再次提取过滤 → [clef 判定]`，其中 `[clef 判定]` 与现有 jev 判定**同签名、同语义**，可配置切换。

---

## 0. 一句话结论

`@cf/cloudflare/clef` 是 Cloudflare 自托管的**结构化判定模型**：输入一段文本 + 若干具名问题，输出概率化的答案（`noul` 0~1 / `choice` 分类 / `score` 分级）。它做的是"这封邮件里有没有验证码 / 验证链接"这一层判断，**不做字符串抽取**，也不支持图片与 `box` 定位。

- 计费：Workers AI **神经元**（免费额度 10k/天），**不经过 AI Gateway，不需要预付额度**。
- 而 `typesafe/jev` 是第三方模型，只能经 AI Gateway 走 Unified Billing 预付扣费。这是"clef 作为 jev 替代"的成本动机。
- 判定效果：10 封样本 A/B 测试中，clef 与 clef-flash 在 `kind` 四分类上同为 8/10，在两个核心概率问题（`otp` / `magic`）上 clef 为 10/10。

---

## 1. 模型事实表

| 项目 | `@cf/cloudflare/clef` | `@cf/cloudflare/clef-flash` | `@cf/cloudflare/clef-omni` |
|---|---|---|---|
| 定位 | 主判模型 | 轻量/低延迟 | 同族，带 vision 标记 |
| 上下文窗口 | 65,536 tokens | 24,576 tokens | 65,536 tokens |
| 输入价 | $0.24 / 1M tokens | $0.038 / 1M tokens | $0.15 / 1M tokens |
| 输出价 | $0（`output_tokens` 恒为 0） | 同左 | 同左 |
| 计费通道 | 神经元（Workers AI 原生） | 同左 | 同左 |
| 需要 AI Gateway | **不需要** | 不需要 | 不需要 |
| 问题类型 | `noul` / `choice` / `score` | 同左 | 同左 |
| 图片输入 `assets` | **不支持**（422） | 不支持 | 实测同样拒绝 `assets` |
| `box` 类型 | **不支持**（422/400） | 不支持 | 不支持 |
| 确定性 | **是**（同输入重复 3 次结果逐位相同） | 未逐一验证，按同族推定 | 未验证 |

实测平均耗时（单封邮件、单一模型）：clef 1.16 s，clef-flash 1.15 s，两者无实质差异 —— **不要用"flash 更快"作为选型理由**，只有价格和上下文长度是真实差异。

**接入建议：默认用 `clef`。** 每 10 万封/月，clef 约 $13、flash 约 $2；这个量级上的差价不值得损失判定质量。当量级到百万/月、成本开始咬人时，改用 `clef-flash` 前置分流 + `clef` 复核灰区（见第 7 节）。

---

## 2. 鉴权与调用路径

需要一个具备 **Workers AI - Read**（若要跑评测脚本还要 Read 之外的写权限时按需）的 Cloudflare API Token，以及 32 位 hex 的 Account ID。

### 2.1 推荐路径：模型名放 URL（path 形式）

```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run/@cf/cloudflare/clef" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "state": "Subject: [GitHub] Please verify your device\n\nEnter this code to continue: 482913",
    "questions": {
      "otp": { "type": "noul", "instructions": "Does this email contain a one-time verification code the recipient must type in to prove they control the account?" }
    }
  }'
```

### 2.2 等价路径：模型名放 body（统一入口）

```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "model": "@cf/cloudflare/clef", "input": { "state": "...", "questions": { ... } } }'
```

两条路径实测返回值完全一致（相同 `noul` 数值）。**优先用 2.1**，少一层 `input` 包裹，且模型名不会与 body 冲突。

### 2.3 三条必须遵守的调用纪律

1. **`model` 字段可省略；一旦写了，必须与 URL 中的模型名一致。** 不一致返回 `422 / code 3030`：`Unsupported model 'clef'. Use 'clef-flash'`。同一份 payload 复用到两个模型时，必须同步改这个字段或干脆删掉。
2. **绝对不要给 clef 请求加 `cf-aig-gateway-id` 头，也不要走 `gateway.ai.cloudflare.com`。** 一旦经过 AI Gateway，账户未开通统一计费时会被 `403 / code 2042 "AI Gateway is not enabled for this account"` 拦掉；clef 作为第一方模型根本不需要网关，直连即可用神经元计费。
3. **不要用 `/ai/run/<model>` 路径形式携带 `typesafe/jev` 这类带斜杠的第三方模型名**（会得到 `400 / 7000 No route`）。这与 clef 无关，但同仓代码里若混用需注意。

---

## 3. 请求 schema

```jsonc
{
  "state":  "string | object",     // 必填。被判定的事实材料；对象会被序列化后送入（实测两者均可）
  "questions": {                    // 必填，且不能为空对象
    "<任意键名>": {
      "type": "noul" | "choice" | "score",
      "instructions": "自然语言，告诉模型要判断什么",
      "criteria": { /* choice 必填：标签 -> 说明 */ } ,
      //     或 [ /* score 必填：按顺序的低 -> 高标签数组 */ ]
    }
  }
}
```

- `state` 建议传字符串（邮件全文）。传对象时 token 数略高（实测 164 vs 156），效果一致。
- `questions` 的键名是**输出回显用的标签**，可任意命名，会原样出现在 `answers` 中。
- `choice` 的 `criteria` 是 `对象`；`score` 的 `criteria` 是 `数组`。写反会触发校验错误。
- 空 `questions: {}` → `400 / code 5006`。

### 3.1 请求体错误对照

| 构造 | HTTP | code | message 摘要 |
|---|---|---|---|
| 用 `type: "box"` | 422（偶尔 400） | 3030 / 5006 | `Input tag 'box' ... does not match any of the expected tags: noul, choice, score` |
| 带 `assets` 图片 | 422 | 3030 | `assets: Extra inputs are not permitted` |
| `model` 与 URL 不一致 | 422 | 3030 | `Unsupported model 'x'. Use 'y'.` |
| `questions` 为空 | 400 | 5006 | `required properties at '/' are 'model,state,questions'` |
| body 非 JSON | 400 | 5006 | 同上（校验层先失败） |

---

## 4. 响应 schema 与字段语义

```jsonc
{
  "result": {
    "model": "clef",
    "answers": {
      "otp":    { "type": "noul",   "noul": 0.967 },
      "team":   { "type": "choice", "choice": "technical",
                  "probabilities": { "billing": 0.158, "technical": 0.827, "sales": 0.014 },
                  "confidence": 0.565 },
      "severity": { "type": "score", "score": 2.948,
                    "legend": { "0": "No impact", "1": "Minor", "2": "Major", "3": "Critical" },
                    "probabilities": { "0": 0.004, "1": 0.005, "2": 0.029, "3": 0.962 },
                    "confidence": 0.901 }
    },
    "usage": { "input_tokens": 346, "output_tokens": 0 }
  },
  "success": true, "errors": [], "messages": []
}
```

四个必须理解清楚的语义点：

1. **`noul` 就是概率**，0~1，可直接与阈值比较。
2. **`confidence` 不是 `probabilities` 的最大值。** 上面的例子里 `technical` 概率 0.827，`confidence` 只有 0.565。`confidence` 是校准后的"这个判断有多可信"，**用于决定是否采信，不用于代表分类概率**。
3. **`score` 是连续期望值**（2.948 落在 2 与 3 之间），不是整数档位。要整数档就取 `probabilities` 里最大者的 `legend` 索引。
4. **`output_tokens` 恒为 0**，成本完全由输入长度决定。因此**截断长邮件**是唯一的降本手段。

---

## 5. 判定协议（推荐配置，已实测）

### 5.1 问题集

```jsonc
{
  "otp": {
    "type": "noul",
    "instructions": "Does this email contain a one-time verification code the recipient must type in to prove they control the account?"
  },
  "magic": {
    "type": "noul",
    "instructions": "Does this email contain a link whose purpose is to verify the recipient's email address or complete a sign-in, as opposed to a marketing or informational link?"
  },
  "kind": {
    "type": "choice",
    "instructions": "Classify the verification artifact in this email.",
    "criteria": {
      "otp_code": "A code the recipient types in",
      "verify_link": "A link that verifies or signs in the recipient",
      "both": "Both a code and a verification link",
      "neither": "No verification artifact"
    }
  },
  "extort": {
    "type": "noul",
    "instructions": "Does this email pressure the recipient to reveal a verification code or credentials to another person, which is a phishing pattern?"
  }
}
```

四条问题合计约 550 输入 token / 封。若只要"是不是"，删掉 `kind` 与 `extort` 可降到约 156 token。

### 5.2 决策规则（按顺序短路）

```
1. extort >= 0.80                → quarantine（标记钓鱼，不进入提取）
2. artifact = max(otp, magic)
   artifact >= 0.60
     otp >= 0.60 && magic >= 0.60 → verdict = verification, kind = both
     otp >= 0.60                  → verdict = verification, kind = otp_code
     magic >= 0.60                → verdict = verification, kind = verify_link
3. artifact <= 0.35              → verdict = not_verification
4. 0.35 < artifact < 0.60        → verdict = unknown（灰区：可交给 jev 复核或跳过提取）
```

### 5.3 关键规则：不要用 `kind.choice` 直接当结论

10 封样本中，两个模型都在同样两例上分类错误：

| 样本 | 真相 | 模型 `kind` | `kind.confidence` | `otp` / `magic` 是否正确 |
|---|---|---|---|---|
| 钓鱼索码邮件（"请把收到的验证码回复给我们"） | 无码可用 | `otp_code` ✗ | 0.276 | `otp=0.220` ✓ / `magic=0.034` ✓ |
| 银行新设备登录提醒（含 6 位参考号） | 无码可用 | `verify_link` ✗ | 0.276 | `otp=0.031` ✓ / `magic=0.309` ✓ |

两个错误样本的 `kind.confidence` 都塌到 **0.28~0.31**，而所有判对样本都在 **0.83 以上**。所以：

- **结论请由 `otp` / `magic` 的概率推导**（规则 5.2），`kind` 只作为辅助展示。
- **`kind.confidence < 0.50` 时一律视为低可信**：要么按 `otp`/`magic` 判，要么升级到 jev 复核。这一条能同时拦掉上面两类误判。

---

## 6. 与 jev 的对齐表（移植脚手架）

| 维度 | jev（`typesafe/jev-1.14.0`） | clef（`@cf/cloudflare/clef`） | 移植动作 |
|---|---|---|---|
| 端点 | `POST /ai/run`，body 带 `model` + `input` | `POST /ai/run/@cf/cloudflare/clef`，body 直接平铺 | 改 URL，去掉 `input` 包裹 |
| `state` | `state` 可为对象/字符串，支持 `assets` 引用图片 | `state` 可为对象/字符串，**不支持 assets** | 有图片的调用点保持走 jev |
| 问题类型 | `noul` / `choice` / `score` / `box` | `noul` / `choice` / `score` | 含 `box` 的问题集不能迁移 |
| 计费 | 第三方，AI Gateway + 预付额度 | 第一方，神经元 | 去掉 `cf-aig-gateway-id` 头 |
| 输出 | `answers.<key>.noul` / `.choice` / `.score` + `confidence` | 同构 | 解析逻辑可复用 |
| 抽取能力 | 无（同为判定模型） | 无 | 正则/二次提取环节保持不动 |
| 确定性 | 未验证 | 是 | clef 结果可缓存、可写快照测试 |

**同签名封装**思路（保持调用方不变）：

```ts
type JudgeVerdict = "verification" | "not_verification" | "unknown";
type JudgeResult = {
  verdict: JudgeVerdict;
  kind: "otp_code" | "verify_link" | "both" | "neither";
  confidence: number;          // 用于是否采信
  signals: Record<string, number>;
  backend: "clef" | "jev";
};
```

现有 jev 适配器把 `answers` 映射到 `JudgeResult`；新增 clef 适配器映射到同一个结构，上层按配置开关切换即可。

---

## 7. 参考实现

### 7.1 TypeScript（Worker / Node 18+，零依赖）

```ts
// language: TypeScript, file: clef.ts, runtime: Workers / Node 18+, target: @cf/cloudflare/clef
const ENDPOINT = (accountId: string, model: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/cloudflare/${model}`;

const QUESTIONS = {
  otp: {
    type: "noul",
    instructions:
      "Does this email contain a one-time verification code the recipient must type in to prove they control the account?",
  },
  magic: {
    type: "noul",
    instructions:
      "Does this email contain a link whose purpose is to verify the recipient's email address or complete a sign-in, as opposed to a marketing or informational link?",
  },
  kind: {
    type: "choice",
    instructions: "Classify the verification artifact in this email.",
    criteria: {
      otp_code: "A code the recipient types in",
      verify_link: "A link that verifies or signs in the recipient",
      both: "Both a code and a verification link",
      neither: "No verification artifact",
    },
  },
  extort: {
    type: "noul",
    instructions:
      "Does this email pressure the recipient to reveal a verification code or credentials to another person, which is a phishing pattern?",
  },
} as const;

export type ClefResult = {
  verdict: "verification" | "not_verification" | "unknown" | "quarantine";
  kind: "otp_code" | "verify_link" | "both" | "neither";
  confidence: number;
  signals: { otp: number; magic: number; kindConfidence: number; extort: number };
};

export async function judgeWithClef(
  text: string,
  env: { accountId: string; token: string; model?: string; maxChars?: number },
): Promise<ClefResult> {
  const model = env.model ?? "clef";
  // 只截断一次，别在调用点各截各的：这是唯一有效的降本手段
  const state = text.slice(0, env.maxChars ?? 12000);

  const res = await fetch(ENDPOINT(env.accountId, model), {
    method: "POST",
    headers: { Authorization: `Bearer ${env.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state, questions: QUESTIONS }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { errors?: { code: number; message: string }[] };
    const code = err.errors?.[0]?.code;
    // 3030 = 请求体不合规（含 model 名与 URL 不一致）；5006 = 校验失败；429 = 限流
    const e = new Error(`clef_failed_${res.status}_${code ?? "unknown"}`);
    (e as Error & { status?: number; code?: number }).status = res.status;
    (e as Error & { status?: number; code?: number }).code = code;
    throw e;
  }

  const body = (await res.json()) as {
    result: { answers: Record<string, { noul?: number; choice?: string; confidence?: number }> };
  };
  const a = body.result.answers;
  const otp = a.otp?.noul ?? 0;
  const magic = a.magic?.noul ?? 0;
  const extort = a.extort?.noul ?? 0;
  const kindConfidence = a.kind?.confidence ?? 0;

  if (extort >= 0.8) {
    return { verdict: "quarantine", kind: "neither", confidence: extort, signals: { otp, magic, kindConfidence, extort } };
  }

  const artifact = Math.max(otp, magic);
  let verdict: ClefResult["verdict"] = "unknown";
  let kind: ClefResult["kind"] = "neither";

  if (artifact >= 0.6) {
    verdict = "verification";
    kind = otp >= 0.6 && magic >= 0.6 ? "both" : otp >= 0.6 ? "otp_code" : "verify_link";
  } else if (artifact <= 0.35) {
    verdict = "not_verification";
  }
  // 灰区（0.35 < artifact < 0.6）保持 unknown，由上层决定是否交 jev 复核

  return { verdict, kind, confidence: kindConfidence, signals: { otp, magic, kindConfidence, extort } };
}
```

### 7.2 Python（标准库，无第三方依赖）

```python
# language: Python, file: clef.py, runtime: Python 3.9+, target: @cf/cloudflare/clef
import json
import urllib.error
import urllib.request

QUESTIONS = {
    "otp": {"type": "noul", "instructions": "Does this email contain a one-time verification code the recipient must type in to prove they control the account?"},
    "magic": {"type": "noul", "instructions": "Does this email contain a link whose purpose is to verify the recipient's email address or complete a sign-in, as opposed to a marketing or informational link?"},
    "kind": {"type": "choice", "instructions": "Classify the verification artifact in this email.",
             "criteria": {"otp_code": "A code the recipient types in",
                          "verify_link": "A link that verifies or signs in the recipient",
                          "both": "Both a code and a verification link",
                          "neither": "No verification artifact"}},
    "extort": {"type": "noul", "instructions": "Does this email pressure the recipient to reveal a verification code or credentials to another person, which is a phishing pattern?"},
}


def judge_with_clef(text, account_id, token, model="clef", max_chars=12000, timeout=60):
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/cloudflare/{model}"
    body = json.dumps({"state": text[:max_chars], "questions": QUESTIONS}).encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                headers={"Authorization": f"Bearer {token}",
                                         "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"clef_failed_{e.code}: {detail}") from None

    a = payload["result"]["answers"]
    otp = a["otp"]["noul"]
    magic = a["magic"]["noul"]
    extort = a["extort"]["noul"]
    kind_conf = a["kind"]["confidence"]

    if extort >= 0.8:
        verdict, kind = "quarantine", "neither"
    else:
        artifact = max(otp, magic)
        if artifact >= 0.6:
            verdict = "verification"
            kind = "both" if otp >= 0.6 and magic >= 0.6 else ("otp_code" if otp >= 0.6 else "verify_link")
        elif artifact <= 0.35:
            verdict, kind = "not_verification", "neither"
        else:
            verdict, kind = "unknown", "neither"

    return {"verdict": verdict, "kind": kind, "confidence": kind_conf,
            "signals": {"otp": otp, "magic": magic, "kind_confidence": kind_conf, "extort": extort}}
```

---

## 8. 流水线插入点

现有两条链路，替换点都在"判定"这一步，前后环节不动：

```
A) 正则提取 ─────────────────────→ [判定: jev | clef]
B) 正则提取 → AI二次提取过滤 ────→ [判定: jev | clef]
```

三条可选策略：

| 策略 | 组合 | 适用 |
|---|---|---|
| 全量替换 | `clef` 独占判定 | 想彻底摆脱 AI Gateway 依赖；接受灰区样本被丢弃 |
| 双跑对照 | `clef` 判，`jev` 异步复判并记录分歧 | 上线前灰度，攒够分歧样本再定阈值 |
| 分流 + 复核（推荐） | `clef-flash` 前置 → `artifact` 灰区或 `kind.confidence < 0.5` 时交 `clef`（或 `jev`）复核 | 量大、既要省钱又要召回 |

无论哪种，`verdict = "unknown"` 必须显式处理：**不要静默当成 `not_verification` 丢弃**，否则灰区里的真验证码会消失。建议落一条 `judge_unknown` 日志，按周回捞校准阈值。

---

## 9. 错误处理与重试

| HTTP / code | 含义 | 处置 |
|---|---|---|
| 200 | 正常 | — |
| 400 / 5006 | 请求体校验失败（空 `questions`、body 非 JSON） | 不重试，属代码 bug |
| 422 / 3030 | 请求体含非法字段（`assets`、`box`、`model` 名不符） | 不重试，属代码 bug |
| 400 / 7000 | 路径里带了不支持的模型名 | 改 URL |
| 400 / 5007 | 模型不存在（例如误写 `@cf/typesafe/jev-1.14.0`） | 改模型名 |
| 403 / 2042 | 走到了 AI Gateway 但账户未开通统一计费 | 去掉 `cf-aig-gateway-id` 头与网关域名，改直连 |
| 429 / 3040 | 限流 / 容量不足 | 指数退避重试，退避基数 0.5 s、上限 5 s、最多 3 次 |
| 5xx | 平台侧 | 同上重试；仍失败则按 `unknown` 落日志，不阻塞邮件主流程 |

**clef 是确定性的**：同一输入重复调用返回逐位相同的数值（已实测 3 次）。因此可以对 `(邮件指纹, 模型名, 问题集版本)` 建缓存，命中率高的场景能直接省掉绝大部分调用。

---

## 10. 成本与容量

单封邮件（4 问题集）实测约 **550 输入 token**，只问 1 个问题时约 **156 token**。

| 月处理量 | clef（$0.24/1M） | clef-flash（$0.038/1M） | jev（$0.042/1M，需预付额度） |
|---|---|---|---|
| 1 万封 | ≈ $1.3 | ≈ $0.2 | ≈ $0.23 |
| 10 万封 | ≈ $13 | ≈ $2.1 | ≈ $2.3 |
| 100 万封 | ≈ $132 | ≈ $21 | ≈ $23 |

注意这张表只算美元标价：clef 的第一笔钱实际上先由**每天 10k 免费神经元**吸收，只有超出后才计费；而 jev 的每一分都必须先充预付额度才能调用（账户额度为 0 时直接 `2042`）。这就是"clef 更划算"的真实理由。

上下文限制：`clef-flash` 24,576 tokens，`clef` 65,536。长邮件线程务必在调用前截断（默认 12,000 字符已足够覆盖绝大多数验证邮件）。

---

## 11. 验收测试（可直接写成单测）

以下 10 条样本的 clef 实测输出是**确定性的**，可直接作为快照断言。判据：`otp >= 0.5` 视为真，`magic >= 0.5` 视为真。

| # | 样本 | 期望 `otp` | clef 实测 | 期望 `magic` | clef 实测 | 期望 `kind` | clef `kind` |
|---|---|---|---|---|---|---|---|
| 1 | 英文 OTP（`482913`） | 1 | 0.967 | 0 | 0.119 | otp_code | otp_code |
| 2 | 中文 OTP（`739201`） | 1 | 0.980 | 0 | 0.025 | otp_code | otp_code |
| 3 | 注册确认魔法链接 | 0 | 0.023 | 1 | 0.980 | verify_link | verify_link |
| 4 | 密码重置链接 | 0 | 0.015 | 1 | 0.884 | verify_link | verify_link |
| 5 | 营销 newsletter | 0 | 0.014 | 0 | 0.046 | neither | neither |
| 6 | 运单（含 20 位 tracking + 订单号） | 0 | 0.026 | 0 | 0.040 | neither | neither |
| 7 | 发票（含 6 位参考号） | 0 | 0.015 | 0 | 0.056 | neither | neither |
| 8 | 钓鱼索码（要求回复验证码） | 0 | 0.220 | 0 | 0.034 | neither | **otp_code**（置信度 0.276，靠 `extort=0.955` 拦住） |
| 9 | 银行新设备登录提醒（6 位参考号） | 0 | 0.031 | 0 | 0.309 | neither | **verify_link**（置信度 0.276） |
| 10 | 码 + 链接并存 | 1 | 0.916 | 1 | 0.967 | both | both |

验收口径：
- 命中率：`otp` / `magic` 两个概率问题 **10/10**；
- 核心要求：**任何一条 `artifact >= 0.6` 的判定，都必须能对上真实存在的可提取码或可点击验证链接**；
- 第 8、9 条必须走到"低置信度/钓鱼拦截"分支，而不是被当成正样本进入提取。

同时把线上真实误判邮件加进这个样本表 —— 尤其是你们业务里出现过的验证码格式（4 位、8 位、带短横线、字母数字混排）与"伪验证"邮件（发票编号、运单号、订单号、交易流水号），这些是概率最容易漂的地方。

---

## 12. 不适用场景（必须保留 jev 或人工）

- **需要图片/截图判定**：clef 全系拒绝 `assets`，`box` 也不支持。截图类邮件继续走 jev（其图像与 `box` 为 beta）。
- **需要抽取字符串**：clef 只输出概率与档位，没有自由文本槽。验证码本体仍靠正则 + 语义锚点（`验证码|verification code|code is|您的 code` + 数字长度约束）。
- **需要跨多封邮件推理**：单次请求单次判定，无会话记忆。
- **要求严格可解释的合规留痕**：clef 只给概率，不给理由文本。需要理由的场景保留 jev 或改由 LLM 生成解释。

---

## 13. 最小接入清单

1. 加一个 `judgeWithClef(text, {accountId, token, model})`，返回 `JudgeResult`（第 7 节代码可直接用）。
2. 与现有 jev 适配器放在同一接口下，用配置项 `JUDGE_BACKEND=clef|jev` 切换。
3. 上层对 `verdict` 四态做分支：`verification` 进提取 / `not_verification` 丢弃 / `unknown` 落日志并可交 jev 复核 / `quarantine` 进钓鱼隔离。
4. 请求头只带 `Authorization`，**不要带 `cf-aig-gateway-id`**。
5. 用第 11 节的 10 条样本跑一遍单测，`otp` / `magic` 数值应逐位吻合。
