# 0xStudy Checker / Asset Monitor

私人资产总览看板：一次打开即可回答“一共多少钱、钱在哪里、这次变化来自谁”。
业务与交付口径以 [`0xStudy-Checker-完整需求规格.md`](./0xStudy-Checker-完整需求规格.md) 为准。

## 总资产口径（不可动摇）

```text
总资产 USD = 链上全部钱包的 DeBank 总净值
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
- **资金变动流水**（`/api/flows`）：每次刷新自动比对上一张快照，把**超过阈值（默认 100 U）**的余额变化记成一条流水，
  包含时间、金额、方向（增加 / 减少）、来源、去路、涉及钱包与前后余额；同一轮里金额接近的一减一增标记为“疑似转账”。
  阈值可在 100 / 500 / 1000 U 之间切换，区间支持 24 小时 / 7 天 / 全部记录。
- **链上资产分布**：资产总览 | 按链 | 按 DApp | 按钱包。按链可展开查看钱包内稳定币、主链币与现货、
  DApp 净值分解，以及折叠的“未计价资产”。链卡片可点击直接筛选下方代币表。
- **代币表**：DeBank Wallet 版式（代币 / 价格 / 数量 / 价值 + 占比条），低于 1 U 的代币自动折叠成一行；
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

部署链路：`GitHub: Ssw7777/asset-monitor` → Vercel 项目 `0x-study`（`vercel.json` 固定 `hkg1`，
便于中国网络与 Binance 访问）。正式站点不需要本机常驻服务，也不创建 Chrome 启动器。

### 云端定时扫描

`GET /api/cron/refresh` 与页面上的「刷新全部」走同一段逻辑，适合放到云端每 10 分钟跑一次：

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<你的域名>/api/cron/refresh
```

- 配置了 `CRON_SECRET` 后，只有带正确 Bearer 头的请求能触发；没配置时只有已登录会话能触发。
- Vercel Cron 需要 Pro 才能跑分钟级计划，所以 `vercel.json` 里默认**没有**写 `crons`；
  可以在 Vercel 控制台或任何外部定时器（cron-job.org、GitHub Actions）里按 10 分钟调用上面的地址。
- 单轮刷新耗时：只读交易所 + 23 个地址约 5~30 秒（取决于是否配置 DeBank Access Key 与是否被限流），
  结果写入快照后才返回，因此定时扫描不会影响打开页面时的速度。

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
| `DEBANK_ACCESS_KEY` | **强烈建议**：官方 Pro 接口，一次请求拿到全部链的代币与 DApp 明细 |

> 没有 `DEBANK_ACCESS_KEY` 时，服务端退化为公共接口，并采用“最多 4 路并发 + 320ms 错峰 +
> 429 全局冷却”的保守策略。限流时页面显示“部分明细受限流影响，已保留最近成功数据”，
> 既不会归零，也不会继续打满限额。实测公共接口对 20+ 地址几乎必然限流，**生产请配置 Access Key**。

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
