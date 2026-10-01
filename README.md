# 创新药授权履约账

管理创新药跨境授权中的地域、适应症、里程碑、共同开发和收益义务。系统先回答“谁能在哪个市场做什么”，再围绕双方确认的事件推动里程碑与付款，让财务可复算每笔付款、项目负责人可看到下一项义务由哪一方承担。

`contracts/license_deal.json` 保存公开的领域样例，用来约定外部数据的名称与层级；样例不含真实个人资料、业务凭据或生产连接信息。

## 领域模型

- **权利图**（`src/rights.js`）：资产（含靶点）× 区域树 × 适应症构成授权单元格，排他范围取值为独占 / 保留 / 非独占。`detectConflicts` 检出相互矛盾的授权（独占重叠、重复独占），`whoCanDo` 回答某方在某市场可从事的活动；未被独占授出的单元格由许可方保留。
- **事件**（`src/events.js`）：临床、注册、销售、专利事件须双方确认方可生效；数据更正会清空确认并暂停相关付款，直至双方重新确认。
- **里程碑**（`src/milestones.js`）：由触发事件与依赖链共同驱动，状态为已达成 / 待事件确认 / 被依赖阻塞，依赖循环会被检出。
- **付款**（`src/payments.js`）：应付日可锚定签约日、固定日、事件日或里程碑达成日；复算链路为总额 → 锁汇折算 → 预提税（支持含税倒算）→ 净额，销售分成按阶梯计算，发票金额与复算结果一致。
- **争议**（`src/disputes.js`）：争议只暂停其目标（付款 / 里程碑 / 事件）直接关联的付款，不连带冻结无关义务。
- **共同开发委员会**（`src/jdc.js`）：利益冲突委员回避后计算法定人数（总人数与每方下限），平局记为僵局并沿升级路径上移。
- **材料权限**（`src/materials.js`）：共享材料的访问权由权利图推导，许可方保留材料不开放。
- **修订**（`src/amendments.js`）：修订须双方批准、版本连续，变更逐条留痕，可按日期追溯生效版本。
- **义务提醒**（`src/obligations.js`）：汇总到期付款、待确认事件与待升级僵局，已暂停付款不出现；可按当事方查看下一项义务。

## 接口

服务启动后（`node src/service.js --port 8000`）提供 JSON 接口：

| 方法与路径 | 说明 |
| --- | --- |
| `GET /health` | 项目标识 |
| `GET /deal` | 交易概要（版本、双方、签约日） |
| `GET /rights/query?asset_id=&territory=&indication=&activity=` | 谁能在哪个市场做什么 |
| `GET /rights/conflicts` | 权利图冲突清单 |
| `GET /milestones` | 里程碑状态与达成日期 |
| `GET /payments?as_of=` | 付款状态（已支付/已暂停/待触发/待锁汇/已逾期/应付） |
| `GET /payments/:id/recompute` | 复算一笔付款（锁汇、扣税、净额） |
| `GET /payments/:id/invoice` | 生成发票（金额与复算一致） |
| `GET /obligations/next?party=&as_of=` | 下一项义务及其承担方 |
| `GET /materials/:id/access?party=` | 材料访问权限 |
| `GET /amendments?at=` | 修订历史 / 某日生效版本 |
| `GET /disputes` | 争议与被暂停的付款 |
| `POST /events/:id/confirm` | 一方确认事件（`{party, by}`） |
| `POST /events/:id/correct` | 数据更正（触发重新确认与精准暂停） |
| `POST /disputes` / `POST /disputes/resolve` | 发起 / 了结争议 |
| `POST /amendments` | 应用双方批准的修订 |
| `POST /jdc/vote` | 议题投票（回避、法定人数、僵局升级） |
| `GET /jdc/quorum?topic=&present=` | 法定人数检查 |

查询参数含中文时需按 URL 编码（浏览器与 `fetch` 会自动处理）。

## 命令

- `npm run check`：检查服务身份。
- `npm test`：运行全部契约与领域测试。
