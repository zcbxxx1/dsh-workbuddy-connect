# 第三方开源声明（Third-Party Notices）

> 本文件记录本项目在设计与实现上参考或移植的开源项目，以及各自的许可证与合规要求。
>
> 通用平台与构建依赖（`@deepseek-ai/*`、`react`、`typescript`、`tsdown`、`vitest` 等）的许可证随各自 npm 包自动携带，不属于本文档范围。

## 一、本项目与上游的关系

本仓库是 [`corrinehu/dsh-workbuddy-connect`](https://github.com/corrinehu/dsh-workbuddy-connect)
的 fork。上游提供了完整的 WorkBuddy 接入内核（桌面端凭据发现与刷新、上游协议、
loopback shim 加固、pi-ai provider 装配、插件卡片），本 fork 在其上增加了两项能力，
并修正了一个缺陷。

| 项目 | 仓库 | 提供了什么 | 许可证 |
| --- | --- | --- | --- |
| `dsh-workbuddy-connect` | <https://github.com/corrinehu/dsh-workbuddy-connect> | 本 fork 的基座：凭据发现与刷新、上游协议、shim、适配器、卡片 | **MIT**（Copyright (c) 2026 Corrine Hu） |
| `dsh-connect-workbuddy` | <https://github.com/dingminhua/dsh-connect-workbuddy> | **代码移植**（见第三节）：账号池的排名/冷却规则、多账号发现策略 | **MIT**（Copyright (c) 2026 LaoDing） |

## 二、本 fork 的改动

| 改动 | 涉及文件 | 性质 |
| --- | --- | --- |
| `workbuddy_search` 宿主工具 | `src/search.ts`、`src/search-tool.ts` | 独立实现 |
| Anthropic-Messages 搜索端点 | `src/search-gateway.ts` | 独立实现 |
| 加密 `nickname` 的解密 | `src/desktop-credential-protection.ts` | 缺陷修复 |
| **账号池** | `src/account-pool.ts`、`src/account-discovery.ts`、`src/pool-store.ts`、`src/account-pool-runtime.ts` | **移植 + 适配**（见第三节） |

## 三、`dsh-connect-workbuddy` 的移植说明

账号池功能**移植**自 `dsh-connect-workbuddy`（MIT，Copyright (c) 2026 LaoDing）。
这是本清单中唯一一项**代码移植**，其余为思路参照。为满足 MIT 的署名义务，
各移植文件头部均标注来源与许可证，并在此逐项说明改动。

### 直接移植的部分

| 移植到 | 来源 | 移植内容 |
| --- | --- | --- |
| `src/account-pool.ts` | `src/account-pool.ts` | 排名规则（可用性 → 积分高 → 快过期 → 凭据新 → 账号 id 作全序）、冷却判定、`POOL_UNKNOWN_COOLDOWN_MS` 兜底、`pickFreeModel`、`effectiveMembersOf` |
| `src/account-discovery.ts` | `src/auth.ts` | 时间戳备份扫描、按账号 id 去重、`isFresher` 的三级排序（live 文件 → `lastRefreshTime` → `expiresAt`） |

### 本项目做的改动（与上游的差异）

1. **类型集收窄。** 上游的 `WorkBuddyPoolOutcome` 有八种取值，来自其「真实体积探测」；
   本插件的探测只回答「该模型接受哪些推理档位」，因此 `account-pool.ts` 只保留本插件
   实际会产生的结果集，并新增 `policy-rejected` 的处理（内容策略拒绝是单次请求的事实，
   不应让账号出池）。
2. **发现逻辑重写为独立模块。** 上游把多账号发现写在 `WorkBuddyCredentialStore` 内部；
   本项目抽成 `account-discovery.ts`，使扫描与「哪个账号是当前账号」两个问题分开，
   且不改变原 store 的解析顺序。
3. **持久化独立实现。** 上游的 `account-pool-store.ts` 存探测记录；本项目的
   `pool-store.ts` 在其上增加了「成员选择」与「观测记录」的分域——前者是用户决策、
   后者是插件观测，同文件不同字段，避免一次测量覆盖用户的选择。
4. **接入点不同。** 上游在适配器层做路由；本项目的 shim 是唯一的请求出口
   （`src/shim.ts` 的 `chatCompletions`），因此池选择接在那里，`pool` 以结构化类型注入，
   **缺省不传即为原行为**（跟随桌面端登录）。
5. **新增 `parseResetTime`。** 上游未提供；本项目需要把 `reset at ... UTC+8`
   （实测时区**无冒号**）解析为冷却时间，故独立实现并测试了两种时区写法。

### 未移植的部分

上游的账号池还包含：一键签到、批量测试、图形化成员勾选与排序展示、
按区域隔离的池文件、以及基于积分包到期的排序输入。这些依赖上游的探测与卡片体系，
本次**未移植**——本 fork 的池只有「成员选择 + 排名 + 失败换号」三件事。

## 四、许可证合规

两个项目均为 **MIT**，与本项目的 MIT 许可证兼容。MIT 的义务是保留版权与许可声明：

- 本文件保留了两者的版权行与仓库地址；
- 移植文件的头部标注了来源模块、上游仓库与许可证；
- 本项目的 `LICENSE` 保持上游的 MIT 文本不变。

## 五、使用方式

若你分发本项目的修改版本，请一并保留本文件与各移植文件的头部声明。
若发现本文件有遗漏，欢迎提交 issue 或 PR。
