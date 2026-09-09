# SPEC · 研发规范

> 配套文档：《民乐老师的 AI 助教 · 产品需求文档 PRD v1.0》
> 版本：v1.0 ｜ 日期：2026-09-08 ｜ 状态：待评审
> 适用：V0.5 – V1.0

本文档规定**怎么做**，PRD 规定**做什么**。两者冲突时以 PRD 为准，并回写本文档。

---

## 0. 三条不可协商的约束

这三条不是"最佳实践"，是产品的生存条件。违反任何一条，代码不得合入。

| # | 约束 | 违反后果 |
|---|---|---|
| **C1** | **系统宁可少说，不可说错。** AI 判定不确定时必须输出 `undetermined`，不得猜测 | 一次误报会让老师终身停用（PRD 09.2） |
| **C2** | **不做价值判断。** 系统只回答"做没做、成没成、稳不稳"，不回答"好不好、对不对" | 技术不成立 + 构成虚假宣传 |
| **C3** | **未成年人数据默认最小采集。** 任何读写必须过关系校验，音频一律私有 + 签名访问 | 合规红线，可导致下架 |

C1–C3 各有一条自动化检查（见 §10），CI 阻断。

---

## 1. 技术栈选型

| 层 | 选型 | 理由 | 被否决的替代方案 |
|---|---|---|---|
| 小程序端 | **Taro 4 + React 18 + TypeScript** | 一套代码可编译到微信/支付宝/H5；TS 保障数据模型一致性 | 原生小程序（未来跨平台需重写）；uni-app（Vue 生态，团队若偏 React 则不选） |
| 后端主服务 | **NestJS + TypeScript + PostgreSQL** | 与前端同语言，2 人小队可互相补位；NestJS 的模块化与 DI 适合快速长出的领域模型 | Python 全栈（算法同学主导时可改，见下） |
| 算法服务 | **Python 3.11 + FastAPI** | onset 检测 / 音高识别 / ASR 生态在 Python | Node（librosa 等无对应） |
| 数据库 | **PostgreSQL 15+** | 强约束（CHECK / ENUM / FK）能在 DB 层兜住合规要求；JSONB 存判定明细 | MySQL（约束能力弱）；MongoDB（无 schema，合规风险高） |
| 缓存 / 队列 | **Redis 7**（队列用 BullMQ） | 音频分析是异步任务，必须走队列 | 内存队列（重启丢任务） |
| 对象存储 | **腾讯云 COS**（私有桶） | 与微信生态同云，上传延迟低；签名 URL 成熟 | 自建 MinIO（运维成本高） |
| 部署 | **Docker Compose → 腾讯云 CVM** | 起步规模不需要 K8s | K8s（3 人团队运维不起） |
| CI | **GitHub Actions** | 与仓库同处 | Jenkins（重） |

**关于"是否统一到 Python"**：如果算法同学愿意承担后端开发，可以改用 FastAPI 全栈，省掉一层语言切换。但**不要在 V0.5 中途切换**——语言栈变更等于重写。此决定必须在 V0.5 启动前定死。

---

## 2. 仓库结构

单仓（monorepo），不拆多仓——3 人团队拆仓只会增加同步成本。

```
music-edu-ai/
├── apps/
│   ├── miniapp/           # Taro 小程序（老师端/孩子端/家长端，同一包按角色路由）
│   └── server/            # NestJS 主服务
├── services/
│   └── audio-ai/          # Python 算法服务（onset/音高/ASR）
├── packages/
│   ├── shared-types/      # 前后端共享的 TS 类型（由 OpenAPI 生成，勿手改）
│   └── domain-dict/       # ★ 技法词表（核心资产，见 §13）
├── infra/
│   ├── docker-compose.yml
│   └── sql/migrations/    # 版本化迁移
├── evals/                 # 评测集元信息（音频本体不入库，见 §8）
│   ├── README.md
│   └── reports/           # 每次回归的结果归档
├── tests/
│   ├── guardrails/        # ★ 红线断言测试（§10）
│   └── e2e/               # 四个核心旅程
└── docs/
    └── PRD.html
```

**禁止**：把评测音频、真实用户数据、生产密钥放进仓库（§11）。

---

## 3. 环境与本地开发

```bash
# 一次性
brew install node@20 python@3.11 postgresql@15 redis docker
cp .env.example .env      # 只填非敏感项；密钥走 CI secrets

# 启动
docker compose up -d db redis
pnpm install
pnpm --filter server migration:run
pnpm dev                  # 同时起 server + miniapp
```

**环境隔离（PRD NFR-09 强制）**

| 环境 | 数据 | 用途 |
|---|---|---|
| `dev` | 全量假数据 | 本地开发 |
| `staging` | **脱敏数据，禁止含任何真实未成年人信息** | 联调、验收 |
| `prod` | 真实 | — |

`prod` 数据**不得**回流 `dev`/`staging`。需要复现线上问题时，用脱敏脚本生成等价数据集。

---

## 4. 分支策略与提交规范

小团队用 **GitHub Flow**，不要 GitFlow（太重）。

```
main            ← 永远可发布；受保护，只能经 PR 合入
└── feat/xxx    ← 功能分支，从 main 切，完成后 PR 回 main
    fix/xxx
    chore/xxx
```

**规则**

1. `main` 受保护：禁止直接 push，需 1 人 Review（你是第二个 Reviewer，至少审 P0 需求）
2. 分支存活 ≤ 5 天；超过则拆小
3. PR 标题用 Conventional Commits，正文必须回答：改了什么 / 为什么 / 怎么验证
4. 合并后自动删除分支

**提交信息格式**

```
<type>(<scope>): <subject>

type: feat | fix | chore | refactor | docs | test | perf
scope: miniapp | server | audio-ai | dict | infra | evals

例：
feat(server): 驾驶舱接口支持按未交天数排序

- 默认排序改为未交天数倒序（PRD FR-M3-05）
- 新增 sort 参数，默认 due_desc
验证：tests/e2e/cockpit.spec.ts 通过
```

---

## 5. 代码规范

**统一工具链**（不要争论格式，交给工具）

| 语言 | Lint | Format | 提交前 |
|---|---|---|---|
| TS/TSX | ESLint (airbnb-base 精简版) | Prettier | `pnpm lint --fix` |
| Python | Ruff | Black | `ruff check --fix && black .` |
| SQL | — | sqlfluff | — |

husky + lint-staged 强制。CI 再跑一次，防绕过。

**命名**

- 领域术语一律用 PRD §1.3 的中文术语对应英文：`task_card` / `micro_goal` / `submission` / `practice_stat`
- **禁止**自造同义词（如 `homework` / `assignment` / `drill`），避免领域概念分裂
- 布尔字段用 `is_` / `has_` 前缀？**否**——本项目沿用 SQL 惯例直接用形容词（`judgeable`、`played`），保持与 PRD 表结构一致

**硬规则**

```ts
// ❌ 禁止：在业务代码里写死模型输出
const result = await analyzeAudio(url);
if (result.score > 80) setStatus('good');        // 价值判断！违反 C2

// ✅ 正确：只消费事实，低置信度直接透传
const stat = await analyzeAudio(url);
if (stat.confidence < CONFIDENCE_THRESHOLD) {
  return { judgement: 'undetermined' };           // 违反 C1 的反面
}
return { judgement: stat.completeness >= target ? 'achieved' : 'not_achieved' };
```

**Magic Number 禁令**：85% 规则阈值、置信度阈值、音频保留天数等，一律从 `packages/shared-config` 读取，禁止散落。它们会被产品和算法反复调整。

---

## 6. 数据库与迁移

**强制规则**

1. **禁止手工改生产表**。一切变更走 `infra/sql/migrations/`，文件名 `YYYYMMDDHHMM__<描述>.sql`
2. 每个迁移必须可重复执行（幂等）并写 `DOWN`
3. 涉及未成年人数据的表，必须有 `relation_id` 外键，用于权限校验
4. 所有表带 `created_at` / `updated_at`

**关键约束（PRD §10.2 已给出 DDL，此处补充约束）**

```sql
-- 师生关系必须经确认（PRD FR-M0-03）
ALTER TABLE relation
  ADD CONSTRAINT chk_relation_confirmed
  CHECK (status IN ('pending','confirmed','revoked'));

-- AI 判定必须带置信度与模型版本（可追溯）
ALTER TABLE practice_stat
  ADD CONSTRAINT chk_confidence_range CHECK (confidence BETWEEN 0 AND 1);

-- 不可判定的技法不得出现在任务卡中（PRD §10.2）
-- 由应用层 + 该约束共同保证：
CREATE INDEX idx_tech_judgeable ON technique_dict (instrument, judgeable);
```

**索引**：按 PRD §10.1 量级，`submission` / `practice_stat` 年增量约千万级，务必
- 对 `(student_id, created_at)` 建复合索引
- `audit_log` 按月分区

---

## 7. API 设计规范（PRD 引用本节）

**基础约定**

- RESTful，版本前缀 `/api/v1`
- 全部 JSON；时间用 ISO 8601（`2026-09-08T14:30:00+08:00`）
- 统一响应包装：

```jsonc
// 成功
{ "code": 0, "data": { ... }, "traceId": "..." }

// 失败
{ "code": 40001, "message": "该学生未确认师生关系", "traceId": "..." }
```

**错误码分段**

| 段 | 含义 |
|---|---|
| `0` | 成功 |
| `1xxxx` | 参数/校验错误 |
| `2xxxx` | 鉴权/关系校验失败（**含未成年人数据越权**） |
| `4xxxx` | 业务逻辑错误 |
| `5xxxx` | 外部依赖失败（ASR / 存储 / 大模型） |

**越权必须返回 `2xxxx` 并写审计日志**（PRD NFR-07），不得返回 `404` 掩盖。

**核心接口**（完整字段见 OpenAPI 文档，由代码注释自动生成）

| 方法 | 路径 | 说明 | 关联 FR |
|---|---|---|---|
| POST | `/api/v1/task-cards` | 创建任务卡（支持批量） | FR-M2-01/03 |
| GET | `/api/v1/task-cards?student_id&week` | 查询（**按角色返回不同文案**） | FR-M2-06 |
| POST | `/api/v1/task-cards/{id}/publish` | 发布并推送 | FR-M2-11 |
| POST | `/api/v1/submissions` | 提交录音（返回上传签名，非直传） | FR-M3-01 |
| GET | `/api/v1/teacher/cockpit` | 驾驶舱一屏数据 | FR-M3-04 |
| POST | `/api/v1/submissions/{id}/review` | 老师批改 | FR-M3-06 |
| GET | `/api/v1/students/{id}/skill-profile` | 技法掌握度 | FR-M5-07 |
| POST | `/api/v1/ai/analyze` | 触发音频分析（**异步，返回 taskId**） | FR-M3-02 |
| GET | `/api/v1/weekly-report/{student_id}` | 家长周报 | FR-M4-02 |

**音频上传流程（必须是签名直传，不得经服务器中转）**

```
客户端 → POST /submissions → 服务端返回 { submissionId, uploadSignature, expiresIn }
客户端 → 直传 COS（用签名）
客户端 → POST /submissions/{id}/confirm → 服务端入队分析
```

**限流**：单用户 10 req/s；`ai/analyze` 单用户 3 req/min（防成本失控，PRD NFR-17）。

---

## 8. AI 模块规范

### 8.1 模型版本与可追溯

- 每次判定必须落 `model_version`（PRD §10.2）。格式：`<service>-<yyyyMMdd>-<gitShortSha>`
- Prompt 存于 `services/audio-ai/prompts/*.prompt.md`，**版本化入库**
- **禁止**在代码里硬编码 prompt 字符串

### 8.2 ASR 抽象层（PRD NFR-14）

必须实现统一接口，云端与自部署两种实现通过同一契约测试：

```python
class ASRProvider(Protocol):
    def transcribe(self, audio_url: str, hotwords: list[str]) -> Transcript: ...

# 实现一：CloudASRProvider（按量付费）
# 实现二：LocalWhisperProvider（自部署，GPU 摊薄）
```

选择由配置决定，**切换不改业务代码**。契约测试两种实现都要跑。

成本参照（25,000 学生规模）：云端 ≈ ¥17,269/月，自部署 ≈ ¥2,219/月。这是约一半毛利，不是小事。

### 8.3 评测集

| 项 | 规范 |
|---|---|
| 位置 | 音频本体存私有桶，**不入库**；`evals/` 只放元信息与标注结果 |
| 标注人 | **必须是具备扬琴教学能力者（产品负责人本人）**。算法工程师不具备此能力 |
| 一致性 | 20% 样本双人标注，Kappa ≥ 0.8 |
| 隔离 | 测试集**不得**参与训练或调参；一旦发现污染，该版本结果作废 |
| 门禁 | PRD §9.2 的准确率门槛；不达标 → 该维度降级为 `undetermined`，**不得上线** |

**回归触发条件**：模型变更 / 词表变更 / prompt 变更 / 每月定时。

**评测报告模板**（PRD §9.4）必须包含**不对称指标**：

```
判定为"达成"的准确率     : ___
判定为"未达成"的准确率   : ___   ← 必须 ≥ 上一行
误报率（把对的判成错的）  : ___   ← 红线
未判定率                 : ___   ← 0% 视为警告，说明系统在硬猜
```

### 8.4 低置信度处理

```python
MIN_CONFIDENCE = 0.60   # 可调，禁止硬编码在业务里

def judge(stat) -> str:
    if stat.confidence < MIN_CONFIDENCE:
        return "undetermined"      # 系统闭嘴
    if not stat.played:
        return "not_achieved"
    return "achieved" if stat.completeness >= target else "not_achieved"
```

**`undetermined` 不得展示为"未完成"**（PRD FR-M3-12）。UI 层必须区分这两种状态。

---

## 9. 测试策略

```
        /‾‾‾‾‾‾‾‾\
       /  E2E 少量  \        4 个核心旅程（PRD §5）
      /--------------\
     /  集成测试 中量  \       API + DB + 队列
    /------------------\
   /    单元测试 大量    \     领域逻辑、规则引擎、判定函数
  /______________________\
```

**覆盖率门禁**

| 层 | 门禁 |
|---|---|
| 领域逻辑 / 规则引擎 | ≥ 85% |
| API 层 | ≥ 70% |
| 全局 | ≥ 70% |

**必须有的测试**

1. **红线断言测试**（§10）——CI 阻断
2. **权限矩阵测试**：每个涉及未成年人数据的接口，都要测"非关系人访问 → 403"
3. **四个核心旅程 E2E**：老师发布 → 孩子练习 → 老师批改 → 家长看周报
4. **判定边界测试**：空音频 / 全噪声 / 超短音频 / 超长音频 / 静音，均须返回 `undetermined` 而非猜测
5. **成本回归测试**：断言微目标结算**不调用**任何大模型或 ASR（PRD NFR-16）

---

## 10. 红线自动化检查（CI 阻断）

这些是"反向需求"——约束的是**不要实现什么**。它们最容易在迭代中被无意违反，所以必须写成测试。

`tests/guardrails/` 下放置：

```ts
// no-ranking.spec.ts
describe('产品红线', () => {
  it('不存在任何排行榜接口', async () => {
    // 1. 扫描路由表，断言无 /rank /leaderboard /ranking
    // 2. 扫描 SQL，断言无 ORDER BY ... 暴露给他人的列表接口
  });

  it('不存在积分/虚拟货币兑换表', async () => {
    // 断言迁移文件中无 points / coins / reward / exchange 表
  });

  it('不存在每日定时推送任务', async () => {
    // 断言 cron 配置中无每日任务；仅允许三种例外推送（PRD FR-M6-07）
  });

  it('不存在 AI 自动生成评语的逻辑', async () => {
    // 断言无 generateComment / autoPraise 等调用
  });

  it('不存在声纹识别相关代码', async () => {
    // 断言无 voiceprint / speaker_embedding / 声纹 相关依赖与调用（PRD NFR-08）
  });

  it('judgement 枚举包含 undetermined', async () => {
    // 数据库 Enum 校验（PRD §10.2）
  });
});
```

**为什么值得写**：这六条测试的成本约 1 人天，但它防止的是"运营同学提了个排行榜需求，新来的开发顺手实现了"这种必然会发生的事。产品差异化的核心，需要工程手段来守住。

---

## 11. 合规与安全

| 项 | 要求 | 落地点 |
|---|---|---|
| 监护人同意 | 绑定学生时必须勾选，记录（时间/版本/openid）落库且不可篡改 | `ConsentRecord` 表，追加写 |
| 关系校验 | 所有未成年人数据读写经过中间件 | `RelationGuard` 中间件 |
| 音频私有 | 私有桶 + 签名 URL（≤2h） | COS 配置 + 上传服务 |
| 最小采集 | 仅麦克风，无后台录音，无环境音 | 小程序权限声明 + Code Review |
| 留存删除 | 练习音频 90 天、课堂录音 30 天，硬删除含备份 | 定时任务 + 删除日志 |
| 审计日志 | 所有未成年人数据读写记录，保留 ≥180 天，应用账号不可删 | `AuditLog` 表，只追加 |
| 数据不出境 | 全部云资源境内 | IaC 地域约束 |
| 密钥管理 | 走 CI secrets / 环境变量，**禁止入库** | `.env.example` + pre-commit 扫描 |

**pre-commit 必须包含密钥扫描**（gitleaks 或同等工具）。

---

## 12. CI/CD 与发布

```yaml
# .github/workflows/ci.yml（摘要）
on: [pull_request]
jobs:
  lint:      # ESLint + Ruff + Prettier + Black
  unit:      # 覆盖率门禁（§9）
  guardrail: # 红线断言（§10）
  secret:    # gitleaks
  migration: # 迁移脚本 dry-run
```

**发布门禁（PRD §14.2 摘录，工程侧可执行的）**

- [ ] P0 需求 AC 100% 通过
- [ ] 红线测试全绿
- [ ] AI 判定通过 PRD §9.2 门槛（不通过则降级为 `undetermined`）
- [ ] 权限测试全绿
- [ ] 种子老师实测 ≥5 人 × 2 周
- [ ] 灰度 1 周无 P0

**灰度与回滚**

- 按 openid 白名单灰度（PRD FR-M0-11）
- 回滚 ≤5 分钟（保留上一个镜像 tag）
- **数据库迁移必须向后兼容**：先加字段 → 双写 → 切读 → 删旧字段，分多次发布

---

## 13. 领域词表管理（核心资产，单独规范）

`packages/domain-dict/` 是本产品**唯一不可外包、不可复制**的资产。通用 ASR 遇到"轮音""反竹""支手轮音""花音"必然出错，且这些词不存在于任何公开数据集。

**结构**

```
packages/domain-dict/
├── yangqin/
│   ├── techniques.yaml      # 技法词表（ASR 热词）
│   ├── goal-templates.yaml  # 微目标表述模板
│   └── unjudgeable.yaml     # 明确不可判定的维度（乐感/表现力等）
└── schema.json
```

**变更流程**

1. 词表变更必须走 PR
2. `CODEOWNERS` 指定产品负责人（你）为**唯一** approver
3. 词表变更**触发 ASR 评测集回归**（PRD §9.2 术语准确率 ≥ 90%）
4. 版本号递增，随 `model_version` 一并记录

**`unjudgeable.yaml` 的作用**：列在这里的维度，UI 层不得出现在可选列表中——从源头杜绝"把不成熟能力包装成完整评分"。

---

## 14. 监控与告警

| 指标 | 阈值 | 告警级别 |
|---|---|---|
| API 错误率 | >2% 持续 5min | P1 |
| P95 延迟 | >1.5s | P2 |
| 音频上传失败率 | >1% | P1 |
| **`judgement_overridden` 老师推翻率** | **>10%** | **P0（最高）** |
| 未判定率周环比 | >+50% | P1 |
| **未判定率 = 0** | — | **P1（说明系统在硬猜）** |
| 单生 AI 成本 | >阈值 150% | P1（PRD NFR-17） |
| ASR 服务可用性 | <99% | P1 |

**`judgement_overridden` 是最高优先级告警。** 当老师开始手动推翻 AI 判定，DAU 可能还没下降（他还在用其他功能），但信任已经破裂，停用只是时间问题。这是唯一能提前预警的指标。

---

## 15. 常见问题（给新加入的工程师）

**Q：能不能加个"AI 判分"让家长看到孩子得了多少分？**
不能。音色、乐感不可判定，给总分等于把不成熟能力包装成完整评价（PRD §3.2）。

**Q：能不能加个排行榜提升活跃度？**
不能。红线测试会阻断（§10）。排行榜触发社会比较焦虑，与 SDT 的胜任感机制冲突。

**Q：能不能用 AI 自动生成鼓励语，省得老师每次都写？**
不能。老师未点评时就该留空。一句假的夸奖比没有夸奖更伤信任（FR-M3-07）。

**Q：孩子没录音，能不能判为"未完成"？**
不能。没录音是"没提交"，不是"未完成"。`undetermined` 与 `not_achieved` 是两个不同的状态（FR-M3-12）。

**Q：为什么 `undetermined` 这个状态这么重要？**
因为它是"系统承认自己不知道"的唯一表达方式。删掉它，等于删掉产品最重要的诚实性设计（PRD §10.2）。

---

## 16. 微信小程序平台约束（2026-09-08 依据官方文档补充）

> 依据：微信开放文档（developers.weixin.qq.com）· 小程序开发指南 / 订阅消息 / 用户隐私保护指引 / RecorderManager / 分包加载

本节来自官方文档核对，**其中"触达能力"一条改写了 PRD 的三条需求**，务必先读。

### 16.1 触达能力：小程序没有"自由推送"（最高优先级约束）

小程序**不具备**任意时刻向用户下发通知的能力。唯一通道是**订阅消息**：

| 机制 | 规则 |
|---|---|
| 一次性订阅 | 需用户<strong>逐次点击授权</strong>；一次调用最多订阅 5 个模板；用户勾选"总是保持以上选择，不再询问"后不再弹窗，且**保持之前的选择**（可能是永久拒绝） |
| 调起时机 | 基础库 **2.8.2 起，必须在用户发生点击行为或发起支付回调后**才能调起订阅界面——不能在无交互时弹窗 |
| 长期订阅 | 仅面向特定行业开放（官方列举政务民生、医疗、交通、金融等），**官方文档未明确列出"教育培训"** |
| 下发上限 | 开通支付能力的小程序 3kw/日，未开通 1kw/日（不是瓶颈，瓶颈是授权） |

**对本产品的直接影响**

PRD 中三条需求被改写：

- `FR-M2-11` 任务卡发布通知 → 改为"订阅授权 + 微信群兜底"双通道
- `FR-M3-08` 一键催交 → 主通道改为**生成可一键转发到微信群的提醒卡片**
- `FR-M6-07` 例外推送 → 明确"实际可达性取决于用户是否授权"

**三个备选方案（建议 C+A 组合）**

| 方案 | 做法 | 代价 |
|---|---|---|
| A. 服务号 | 认证服务号（企业主体）模板消息，用户关注后触达更稳定 | 需企业主体 + 认证费用；用户需关注 |
| B. 埋点式授权 | 在关键交互中"顺便"请求订阅授权（如家长首次查看任务卡时） | 一旦用户勾选"不再询问并拒绝"，永久失联 |
| **C. 微信群兜底**（推荐为主） | 产品只做结构化与沉淀，触达交给老师已有的微信群 | 依赖老师动作，但**这本来就是真实发生的路径** |

> **为什么 C 是主通道而不是备胎**：老师的微信群已经存在、家长已经在里面、老师本来就在群里发作业。
> 这与 PRD 的 V0.1（微信群 + 表格手工验证）是同一条路径——**V0.1 不只是验证形式，也在验证触达率**。
> 若 V0.1 阶段在微信群里的回课率都不达标，那么"做个小程序自动通知"更救不回来。

**待确认 Q7**：教育培训类能否申请长期订阅消息 → 需向微信平台/服务商核实，V0.5 启动前完成。

### 16.2 隐私保护指引（提审会校验）

- 涉及个人信息的小程序**必须**在 mp 后台配置《用户隐私保护指引》
  入口：账号设置 → 服务内容声明 → 用户隐私保护指引
- 提审时平台会比对**代码实际调用的隐私接口**与**声明内容**，不符将被拦截
- 录音属隐私接口，代码需调用 `wx.requirePrivacyAuthorize` / `wx.getPrivacySetting`
- **每次新增隐私接口都要同步更新指引**，否则提审被拦

对应 PRD `NFR-19`。

### 16.3 录音实现要点

`RecorderManager` **全局唯一**，`wx.getRecorderManager()` 获取。

官方示例参数（可直接采用）：

```js
const recorderManager = wx.getRecorderManager()
recorderManager.start({
  duration: 10000,        // 单位 ms
  sampleRate: 44100,
  numberOfChannels: 1,    // 单声道即可，节省体积
  encodeBitRate: 192000,
  format: 'aac',
  frameSize: 50
})
```

**必须处理的两个中断事件**（官方文档明确：微信语音聊天、视频聊天会占用系统录音，导致录音被暂停）：

```js
recorderManager.onInterruptionBegin(() => {
  // 录音被强制中断：不得静默丢弃已录内容
  // 提示"录音被来电打断"，提供「继续录 / 重录这一遍」
})
recorderManager.onInterruptionEnd(() => {
  // 收到此事件后才可再次录音成功
})
```

> 这不是边缘情况。孩子练琴时家长收到微信语音是高频事件。
> 一次静默丢音，家长就会认为"这软件不靠谱"。对应 PRD `FR-M3-15` / `NFR-20`。

### 16.4 分包与包体

- `app.json` 中声明 `subPackages`；**`tabBar` 页面必须在主包内**
- 分包之间**不能互相 require / import / 使用资源**（需"分包异步化"才不受限）
- 建议按角色分包：`pkg-teacher` / `pkg-child` / `pkg-parent`，三端互不加载

> 具体包体上限以微信开发者工具与官方文档为准（会随版本调整），**不要凭记忆写死数值**；
> 在 CI 中加一步：构建后打印各包体积，超过阈值告警。

### 16.5 类目与资质

- 教育类小程序需选择对应服务类目，可能要求提供资质材料
- 与 PRD `NFR-10`（ICP 备案 + 等保 + 教育 App 备案）合并处理，**提前启动，不要等到提审**

---

## 17. MVP 可运行原型（v0.2）工程约定

原型与小程序正式版**共存**，不是一次性废品。约定如下，避免原型代码被误当成生产代码。

### 17.1 目录与形态

```
mvp原型/
├── 扬琴AI助教-MVP原型.html      # 离线单文件（file:// 打开，数据存 localStorage + IndexedDB）
└── server/
    ├── server.js                # 零依赖 Node 服务（单端口，JSON 文件存储）
    ├── scores.json              # 内置谱库（五线谱数据）
    ├── data/state.json          # 运行时状态（可丢）
    ├── data/audio/              # 上传的录音 / 视频
    └── public/
        ├── index.html           # 唯一源文件（双端由它派生，务必改这个）
        ├── teacher.html         # 由 index.html 派生：/t
        └── student.html         # 由 index.html 派生：/s
```

**铁律：`public/index.html` 是唯一源文件**，`teacher.html` / `student.html` 由拆分脚本生成，
不要直接改派生文件，否则下次拆分会被覆盖。

### 17.2 五线谱渲染

- 自绘 SVG，零依赖。`STAFF_TOP` / `STAFF_GAP` 为五线间距常量，`pitchY(p)` 计算音高纵坐标
- 音符数据结构：`{ p:'C4', d:1|0.5, tie:bool, t:'轮音' }`
- 批注挂在 `{ li, i }`（行号 + 音符序号）上，不改公共谱库

### 17.3 同步协议

- 客户端 3 秒轮询 `GET /api/state`；有弹层打开时**不重渲染**（避免打断录音/批注）
- 写操作一律走 `POST /api/patch`，按 `{ kind:'homework'|'student'|'state', id, patch }` 增量更新
- `pull()` 用 `SYNCING` / `PENDING` 双标志排队，避免并发覆盖

### 17.4 持久化降级

- 服务端 `save()` 捕获 `EACCES` / 只读文件系统，降级为纯内存并打印一次警告（云端部署常见）
- 客户端 `ONLINE = location.protocol.indexOf('http') === 0`，`file://` 自动切单机模式

### 17.5 红线自检（每次改动后跑）

1. 代码中不存在任何"AI 自动生成评语/鼓励语"的逻辑（PRD FR-M3-07）
2. 不存在按达成率 / 时长对用户排序并展示给他人的功能（FR-M6-04 禁排行榜）
3. 不存在积分商城 / 实物兑换（FR-M6-05）
4. 界面不出现百分制、星级、"优秀/良好/及格"
5. 不出现"进步/退步/不认真"等价值判断措辞（FR-M3-11、FR-M5-08）

### 17.6 自测

两个独立浏览器上下文跑双端全链路（老师布置 → 孩子练习提交 → 老师批改 → 孩子看到评语），
断言 21 项通过、页面 JS 错误 0 方可发布。

---

## 变更记录

| 版本 | 日期 | 内容 |
|---|---|---|
| v1.0 | 2026-09-08 | 首版，随 PRD v1.0 同步产出 |
| v1.1 | 2026-09-09 | 新增第 17 节：MVP 可运行原型 v0.2 的工程约定（目录铁律、五线谱渲染、同步协议、降级策略、红线自检） |
