# 创新药授权履约账

管理创新药跨境授权中的地域、适应症、里程碑、共同开发和收益义务。系统先回答“谁能在哪个市场做什么”，再跟踪事件、付款与争议的连锁后果。

`contracts/license_deal.json` 保存公开的领域样例，用来约定外部数据的名称与层级；样例不含真实个人资料、业务凭据或生产连接信息。

## 领域模型

| 模块 | 职责 |
| --- | --- |
| `src/domain/rights.js` | 权利图：交易版本下的资产 × 靶点 × 区域 × 适应症 × 排他范围；层级范围树展开、冲突检测、`whoCanDoWhat` 查询 |
| `src/domain/milestones.js` | 里程碑状态机：依赖未确认不能申报；事件由一方申报、对方确认（双方确认原则），支持异议回退 |
| `src/domain/payments.js` | 付款：汇率锁定（取锁定日前最近牌价）、预提税发票（总额−扣税=净额，并折算本位币）、逐笔复算、销售分成档位 |
| `src/domain/disputes.js` | 争议与数据更正：只暂停被点名的付款，绝不连带冻结无关义务；更正留痕并重开发票 |
| `src/domain/committee.js` | 共同开发委员会：回避成员不计入法定人数；僵局沿升级阶梯上行，用尽后按终局决策矩阵或仲裁裁定 |
| `src/domain/obligations.js` | 下一项义务由哪一方承担（按到期日排序）与窗口期提醒 |
| `src/domain/audit.js` | 修订追溯：每次修订生成新版本，内容哈希串联成链，可校验篡改 |
| `src/domain/materials.js` | 材料权限：所有方恒可读，约定里程碑确认后才向对方解锁，访问留痕 |
| `src/domain/money.js` | 金额一律以最小货币单位整数计算，保证财务可复算 |
| `src/store.js` | 用契约样例起账的内存台账，串联各领域模块（确认里程碑 → 排程付款 → 锁汇） |

## HTTP 接口

服务启动后（`node src/service.js --port 8000`）：

- `GET /health` — 项目标识
- `GET /api/deal` — 交易概要；`GET /api/audit` — 版本链与校验；`POST /api/amendments` — 双方批准的修订
- `GET /api/rights?territory=美国&action=商业化` — 谁能在哪个市场做什么；`GET /api/rights/conflicts` — 权利冲突
- `GET /api/milestones` — 里程碑看板；`POST /api/milestones/{id}/report|confirm|reject`
- `GET /api/payments` — 付款台账（含复算标识）；`POST /api/payments/{id}/invoice|pay`；`GET /api/payments/{id}/recompute`
- `POST /api/royalties/accrue` — 按季度净销售额计提销售分成
- `POST /api/disputes`、`POST /api/disputes/{id}/resolve` — 争议冻结（仅相关付款）与解除/更正
- `GET /api/obligations/next?today=YYYY-MM-DD` — 下一项义务与承担方；`GET /api/reminders?today=…&window=…` — 到期提醒
- `GET /api/committee/quorum?topic=…&attendees=…`；`POST /api/committee/vote`、`POST /api/committee/escalate`
- `GET /api/materials`；`POST /api/materials/{id}/access`

## 开发

```sh
npm run check   # 检查服务身份与样例权利图一致性
npm test        # 运行全部契约、领域与端到端测试
```
