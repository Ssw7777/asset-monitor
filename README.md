# 0xStudy Checker / Asset Monitor

私人资产总览看板：一次打开即可回答“一共多少钱、钱在哪里、这次变化来自谁”。
业务与交付口径以 [`0xStudy-Checker-完整需求规格.md`](./0xStudy-Checker-完整需求规格.md) 为准。

## 总资产口径（不可动摇）

```text
总资产 USD = 链上全部钱包的去重净值
           + OKX + Binance + Gate
           + 手动记账资产
```

- 地址忽略大小写去重；同一地址的“钱包总额”与“协议仓位”绝不相加。
- DApp / 链 / 代币列表只用于解释与下钻，**不构成额外一笔资产**。
- 刷新失败时保留最近一次成功余额，状态如实标注，**不归零**。

## 功能

- **单位**：全站记账单位统一为 **USDT**（显示 `1,234.56 U`），CNY 仅作换算参考。
- **总览**：总资产、CNY（可编辑汇率并自动保存）、链上 / 交易所 / 手动三来源。
- **资产趋势**：1 小时 / 12 小时 / 24 小时 / 7 天，按“目标时间点之前或最接近”的真实快照比较；
  悬停吸附数据点显示精确 USD、时间与组成；历史不足时明确提示而不是显示 $0。
- **资产变动横幅**：默认紧凑，可展开并按绝对变动降序列出钱包、交易所、DApp、手动资产的前值 / 现值 / 变化 / 状态。
- **资金变动流水**（`/api/flows`）：每次刷新自动比对上一张快照，把**达到阈值（默认 50 U）**的余额变化立即写入长期流水，
  包含时间、金额、方向、变动钱包 / 交易所与前后余额；同一轮里金额接近的一减一增标记为“疑似转账”。
  阈值可在 50 / 100 / 500 U 之间切换，区间支持 24 小时 / 7 天 / 全部记录；流水最多保留 10,000 条，不随 7 天快照淘汰。
- **链上资产分布**：资产总览 | 按链 | 按 DApp | 按钱包。按链可展开查看钱包内稳定币、主链币与现货、
  DApp 净值分解，以及折叠的“未计价资产”。链卡片可点击直接筛选下方代币表。
- **代币表**：钱包明细版式（代币 / 价格 / 数量 / 价值 + 占比条），低于 50 U 的代币自动折叠成一行；
  点击任意代币可看到它分别由哪些钱包持有、各持有多少。
- **交易所**：OKX / Binance / Gate 三家并发只读读取（无 Bybit），失败保留上次成功值。
- **手动资产**：`+ 添加` 直接保存，自动并入总额、CNY 与历史快照。
- **地址管理**：最多 50 条，新增 / 编辑 / 删除（带确认）/ 批量粘贴导入，逐条校验并提示重复项。
- **导出**：钱包 CSV（名称、地址、类型、余额、最近成功刷新、数据状态、Top 链 / DApp）与
  DApp 明细 CSV 分开导出，避免重复相加。

## 运行与部署

```bash
pnpm install
cp .env.example .env.local     # 填入变量，不要把真实值提交到仓库
pnpm dev                       # 本地开发
pnpm build && pnpm start       # 生产构建预览
```

推荐部署链路：GitHub 源码仓库 → Vercel 项目（`vercel.json` 固定 `hkg1`，便于中国网络与 Binance 访问）。
Vercel 负责构建和运行网页/API；Turso 负责持久化业务数据，不能依赖 Vercel 临时文件系统保存资产历史。

### 云端定时扫描

`GET /api/cron/refresh?mode=auto` 与页面上的刷新逻辑共用同一实现，应由可信定时器每 5 分钟调用一次：

```bash
curl --fail-with-body -H "Authorization: Bearer $CRON_SECRET" "https://<你的域名>/api/cron/refresh?mode=auto"
```

- 云端定时请求必须携带正确的 `Authorization: Bearer <CRON_SECRET>`；浏览器内的手动刷新仍使用登录会话。兼容用的 `?token=` 仅保留给旧本机任务，迁移后停用。
- Vercel Hobby 每天运行一次 `/api/cron/refresh` 作为云端兜底；五分钟 GitHub Actions 工作流已在本地准备，待仓库权限和运行费用方案确认后上传启用。
- 每轮都会写入一条 Turso 快照；2016 条上限覆盖 7 天，达到 50 USDT 的变动会在快照淘汰前另存为长期流水。
- 刷新使用 Turso 分布式租约避免计划任务、手动刷新互相覆盖；云端状态检查只输出时间和数量，不输出余额、地址或密钥。
- 云端五分钟工作流启用前，钱包轮询仍由 Windows 计划任务触发，因此电脑和代理需要在线；电脑关闭时只剩 Vercel 每日兜底。
- Zerion 只校准代币明细，每轮最多一个地址、单地址三小时内不重复尝试，25 个钱包稳定上限约 200 次/天。

### 环境变量（全部服务端）

见 [`.env.example`](./.env.example)。关键项：

| 变量 | 作用 |
| --- | --- |
| `DASHBOARD_PASSWORD` / `SESSION_SECRET` | 看板会话；密码长度不设下限，可自行使用短数字密码 |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | 持久化地址、手动资产、汇率、历史快照 |
| `ENCRYPTION_KEY` | 可选，AES-256-GCM 加密存储 CEX 密钥 |
| `OKX_API_KEY` / `OKX_API_SECRET` / `OKX_API_PASSPHRASE` | OKX 只读余额 |
| `BINANCE_API_KEY` / `BINANCE_API_SECRET` | Binance 只读余额 |
| `GATE_API_KEY` / `GATE_API_SECRET` | Gate 只读余额 |
| `ZERION_API_KEY` | 低频校准普通代币数量、价格、图标和所属链；约 200 次/天 |
| `DEBANK_ACCESS_KEY` | 完全可选；当前免费方案不依赖此变量 |

> 免费方案采用“最旧成功时间优先 + 最多 4 路并发 + 900ms 错峰 + 429 全局冷却”。
> 限流时保留最近成功数据和真实时间，既不会归零，也不会伪装成实时数据。
> Zerion 请求失败也会记录尝试时间，避免每五分钟重复失败而打穿日额度。

## 安全

- API Key / Secret / Passphrase / Turso Token / 会话密钥只存在于 Vercel 环境变量或服务端 AES-256-GCM 密文；
  `/api/portfolio` 等接口显式剔除加密凭据字段，绝不下发浏览器。
- 仅请求余额类接口，不实现下单、提现、划转、API 管理。
- 输入 URL 只允许 `http:` / `https:`；用户文本由 React 转义渲染，不使用 `dangerouslySetInnerHTML`。
- 日志不打印请求头、签名、Secret、Passphrase 或完整环境变量。

## 开发校验

```bash
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint .
pnpm build
```

三项均需通过后再发布 Preview，Preview 验证通过后才覆盖 Production。
