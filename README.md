# DSH WorkBuddy Connect


[English](./README.en.md) | 中文


将 WorkBuddy 桌面 App 中包含的各种模型（GLM-5.3、GLM-5.2、DeepSeek-V4-Pro、DeepSeek-V4-Flash、Kimi-K3、MiniMax-M3、Hy3 等）自动接入 DeepSeek Harness，实现在 DSH 对话窗口里零配置使用。

国内版 **WorkBuddy** 与国际版 **WorkBuddy AI** 同时支持：装哪个 App 就出现哪个模型分组，两个都装就两组并存，各自用自己的账号与积分。

> **这是 [`corrinehu/dsh-workbuddy-connect`](https://github.com/corrinehu/dsh-workbuddy-connect) 的 fork**，在 0.7.1 基础上增加了 **账号池**（多账号轮换与故障转移）、**`workbuddy_search` 宿主工具**与 **Anthropic-Messages 搜索端点**，并修复了 **`--trusted-host` 部署下插件路由全部 403** 的问题。
>
> **本 fork 的改动尚未发版**：`package.json` 版本号仍是 `0.7.1`，与 npm 上的上游 0.7.1 **代码不同**。因此**不要**用 `dsh-workbuddy-connect@0.7.1` 安装——那样装到的是上游版本，本文描述的账号池等能力都不会出现。安装方式见下方「安装」。


## 功能

- **开箱即用**：安装和启用插件后，在 DSH 中直接使用，无需额外配置。

![WorkBuddy 模型出现在 DSH 模型选择器中](assets/1.png)


- **国内版与国际版并存**：国内版显示为「WorkBuddy」分组，国际版显示为「WorkBuddy AI」分组。两版的模型、账号和积分互不混用，**各自只看自己那版 App 的登录状态**：只装国际版就只出现「WorkBuddy AI」，两版都装就两组都在，退出其中一版则对应分组消失。设置里也是**两张卡片**，分别展示各自的账号与余额。

![WorkBuddy AI 模型出现在 DSH 模型选择器中](assets/5.png)


- **图片输入**：大部分模型支持发图，在对话里直接粘贴或拖入图片即可（GLM-5.3-Flash、GLM-5.2、DeepSeek-V4 系列等）；少数只支持文字的模型（如 GLM-5.1）会明确提示不支持。


- **推理档位**：WorkBuddy 明确声明的档位会直接显示，例如 GLM-5.3 和 GLM-5.3-Flash 可选 low / high / max。对于没有声明可选档位的模型，Web 和 Desktop 可在模型选择器中点击「推理等级」手动检测；检测会发送少量请求，可能消耗积分。未检测或没有可用档位的模型仍使用 WorkBuddy 的默认档位。


- **信息查看与检测**：设置 → 插件 → 对应卡片可查看账号、令牌有效期、剩余积分和模型优惠；也可以手动刷新模型列表，并看到当前列表来自上游还是内置兜底。对于可检测模型，也可以在这里手动检测推理档位。

- **模型显隐**：两张卡片都可以在「上下文窗口」标签里勾选要在模型选择器中显示的模型。隐藏配置**按登录账号分别保存**：切换账号自动切换各自的配置，切回后恢复；新账号和新上架的模型默认显示。隐藏只影响选择器里的可选性，**正在使用该模型的已有会话不受影响**。

![上下文窗口列表里的模型显隐](assets/6.png)

- **企业账号积分**：国内版企业账号（`enterpriseId` 非空）走企业专用计费接口读取周期额度，卡片显示「企业额度」与周期重置时间。

- **费率比例**：模型选择列表里每个模型名后直接显示积分倍率（如 `GLM-5.2 · x0.79`、`Hy3 · x0.00`），`/model` 弹窗与输入框的模型下拉都能看到。倍率只是显示，不影响实际请求。


- **徽章展示**：促销徽章（限时免费、夜间折扣）直接跟在模型名后面（如 `Hy4 preview · x0.00 · 限时免费`），选模型时一眼可见；设置卡片里也会汇总当前有优惠的模型。以 WorkBuddy 服务端的数据为准，每次启动 DSH 时同步。国际版的促销来自服务端的 `modelPromotions`（含生效时段）：促销过期后徽章会撤销；由于服务端把折后价直接写在模型的倍率字段里，原价无法还原，此时该模型的倍率会显示为「价格未知 — 刷新后更新」。

![设置卡片显示插件](assets/2.png)

卡片展开后分为「状态 / 上下文 / 明细」三个标签：状态页展示账号、令牌有效期、合计积分、模型列表来源与推理档位检测；上下文页列出各模型的上下文窗口，国际版在上游声明了更大可选窗口时可在此切换「使用上游声明的最大上下文窗口」（**默认开启**，关闭后改用上游默认窗口，偏好持久化）；明细页展示各套餐余量与模型优惠。

![设置卡片显示账号与剩余积分](assets/3.png)

## 账号池（本 fork 新增）

WorkBuddy 桌面端每次登录会在同一目录留下 `workbuddy-desktop-ai.info`（当前登录）与带时间戳的历史备份。**账号池**把这些备份也纳入选择范围：把要用的账号勾进池子，插件就会在每次请求时按规则挑一个账号计费，某个账号失败时自动换下一个。

> **默认关闭。** 关闭时行为与原来完全一致——跟随桌面端当前登录。开启后由插件决定谁计费。

排名规则（优先级从高到低）：

| 优先级 | 规则 | 理由 |
| --- | --- | --- |
| 1 | **可用性** | 能计费的账号永远排在所有被排除的账号之前 |
| 2 | **积分多的优先** | 先用余额多的，让快见底的账号被保留而不是被先耗尽 |
| 3 | **快过期的优先** | 即将过期的积分到期即归零，早用优于留着 |
| 4 | **凭据更新的优先** | 避免过期的令牌在平局时胜出 |
| 5 | **账号 id** | 兜底键，使排序**全序**——否则同一池两次运行可能轮换顺序不同 |

失败处理：`401` 判定为凭据被拒（需重新登录，等待无用）；`429` 与区域配额码 `code=6004` 判定为限流（冷却到上游声明的重置时间）；`5xx` 与传输失败判定为暂时性（冷却后自动回到池中）。`HTTP 400` **不换号**——同一个请求体换谁都是 400，重试只是白等。

配置：

```yaml
- id: llm-workbuddy
  config:
    accountPool: true          # 默认 false
```

池文件位于 `$DSH_HOME/.workbuddy-pool-<variant>.json`，分两域：`members` 是你的选择（只在勾选时写入），`probes` 是插件的观测（随请求写入）。两者同文件不同字段，因此一次测量**不会**覆盖你的选择。

### `workbuddy_search` 与搜索端点（本 fork 新增）

本 fork 还把 WorkBuddy 的搜索能力暴露给 DSH：

- **宿主工具 `workbuddy_search`**：在对话里直接可用的搜索工具。
- **Anthropic-Messages 搜索端点**：可把 DSH 自带的 `web_search` 指向本插件，方法是把 `web-search-deepseek.baseURL` 设为 `<dsh web origin>/plugins/dsh-workbuddy-connect/search`。该端点即使宿主工具关闭时也会注册——两者是同一能力的两种接入方式。

> 账号池实现移植自 [`dsh-connect-workbuddy`](https://github.com/dingminhua/dsh-connect-workbuddy)（MIT）。

## 推理档位为什么这样设计

WorkBuddy 中模型的推理档位信息目前分散在上游接口与客户端自身的私有 UI 逻辑中，且模型目录变化很快。若插件根据经验为所有未声明模型补齐统一档位，就需要持续追赶这些未公开、没有稳定契约的产品逻辑。

![设置档位](assets/4.png)

实测还发现，有些模型虽然接受 `reasoning_effort` 参数，却可能忽略未知值并回退到默认行为；一次请求成功，并不能证明某个档位真实可用。

因此，对于没有声明档位的模型，Web 和 Desktop 采用用户主动授权触发、动态获取档位的方式：先确认上游会校验该参数，再逐项确认哪些规范档位被接受。检测会发送少量请求，可能消耗积分；结果只表示当前上游接受该档位，不承诺它一定改变推理效果、速度或积分消耗。

## 安装

前置：已安装并登录 WorkBuddy 桌面 App。插件复用 App 的登录状态，账号切换自动跟随；装了国际版 WorkBuddy AI 的同样适用，两版互不影响。

**版本对应**：自 `0.6.0` 起，同一个插件版本横跨两代 DSH 核心；自 `0.7.0` 起插件仅面向 `0.2.0` 内核，`0.1.x` 用户请停留在 `0.6.5`。

| 插件版本 | 要求的 DSH 核心 | 桌面 App |
|---|---|---|
| **0.7.1（当前）** | **仅 `0.2.0-rc.2`**（`0.2.0-rc.1` 用户请停留在 `0.7.0`），`@earendil-works/pi-ai` peer 为 **`^0.87.1`** | 内置 `0.2.0-rc.2` 内核的桌面版（预览 / nightly） |
| **0.7.0** | `0.2.0-rc.1` / `0.2.0-rc.2`；适配 `0.2.0` 的设置服务改造 | 内置 `0.2.0` 内核的桌面版 |
| **0.6.5** | `0.1.5` / `0.1.6` / `0.1.7` / `0.2.0-rc.1`（`0.1.x` 线最终版） | 内置 `0.1.x` 内核的桌面版（含 `2.0.7` 起正式版） |
| **0.3.2 – 0.5.4** | `0.1.5-rc.1` 系列（不支持 `0.1.6+`） | `2.0.7`+ |

不匹配的组合会导致 DSH 启动失败。完整历史对照见上游 README。

### 安装本 fork

**关键：装本仓库，不要装 npm 上的同名包。** 本 fork 的改动尚未发版，`@0.7.1` 装到的是上游代码。

```sh
# Web（推荐）：从本仓库源码安装
dsh plugin --profile web add github:zcbxxx1/dsh-workbuddy-connect
dsh web

# 需要可复现时，锁到具体 commit：
dsh plugin --profile web add github:zcbxxx1/dsh-workbuddy-connect#<commit>
```

> 用 `github:` 安装时插件的 `prepare` 脚本会被 pnpm 拦截，需按 pnpm 打印的提示把对应键加到 `pnpm-workspace.yaml` 的 `allowBuilds` 下。本 fork 的 `lib/` 已入库且与源码同 commit，因此多数情况下无需本地构建。

```sh
# TUI（终端界面）：该 profile 需用 pnpm 11 安装
dsh plugin --profile dsh-tui add github:zcbxxx1/dsh-workbuddy-connect
dsh --profile dsh-tui
```

**Desktop 桌面版**不走命令行：`desktop` profile 由桌面 App 独占管理，CLI 一律拒绝（`profile "desktop" is managed exclusively by the Electron application`）。请在桌面 App 内置的插件管理里安装，或走文件方式：① 确认桌面 App 实际使用的 profile 目录（默认 `~/.dsh/profiles/desktop`，Windows 为 `%USERPROFILE%\.dsh\profiles\desktop`）；② 完全退出桌面 App；③ 备份该目录的 `package.json` 与 `pnpm-lock.yaml`；④ 在 `dependencies` 中加入 `"dsh-workbuddy-connect": "github:zcbxxx1/dsh-workbuddy-connect"`；⑤ 在该目录用匹配的 pnpm 执行安装（优先用桌面 App 自带的 pnpm）；⑥ 重启桌面 App。

### 安装后

重启 DSH 后，模型选择器里应出现「WorkBuddy / WorkBuddy AI」分组——只装国内版或只装国际版时，只需验证对应的那一组。**分组与积分可见只说明插件加载、目录与账号读取正常；请再从中选一个模型完成一次简短对话，能正常回复才算接入成功。**

> **`--trusted-host` 部署（本 fork 修复）**：若你用 `dsh web --host 0.0.0.0 --trusted-host <authority>` 把 GUI 发布在真实域名上，上游 0.7.1 的插件路由只认回环地址，卡片与账号池页面会加载出外壳却报 `读取账号池失败: HTTP 403`。本 fork 让插件路由复用宿主已声明的 trusted authority，此类部署下可正常工作；未声明的域名、跨源请求与 DNS rebinding 仍一律拒绝。
>
> 此修复需**重启 DSH** 才会生效：插件路由在启动时挂载。

### 各版本的配置入口

```text
DSH 0.1.5 + 本插件
├─ 设置 → 插件：✅ 两张配置卡片（国内版 / 国际版）
└─ 聊天模型选择器：✅ WorkBuddy / WorkBuddy AI 分组

DSH 0.1.6+ / 0.2.0 + 本插件
├─ 主界面 → 插件 → workbuddy-connect → 查看：✅ 两张配置卡片
├─ 设置 → 账号池：✅ 账号池页面（本 fork）
└─ 聊天模型选择器：✅ WorkBuddy / WorkBuddy AI 分组
```

自 `0.6.0` 起 Models 设置页不再显示 WorkBuddy 的不可编辑卡片（两代核心行为一致），模型选择器、`/model` 与对话调用不受影响。`0.2.0` 起设置服务改为 Config 表单门面，插件按其实际能力自适应：在 `0.1.5` / `0.1.6` 上照旧安装设置分区，在 `0.1.7+` / `0.2.0` 上降级为无设置项的 provider——模型、选择器、模型显隐与上下文窗口照常工作，只是「使用上游声明的最大上下文窗口」这一偏好不再可持久化。

> **TUI 用户请注意**：终端界面插件 `@deepseek-harness-tui/dsh-tui` 需 **`0.10.0-beta.5` 及以上**（更早版本装了本插件会启动失败，报 `events is not iterable`）。推理档位的手动检测入口目前仅提供给 Web 和 Desktop。

## 命令行

`dsh plugin --profile <web|dsh-tui> exec dsh-workbuddy-connect status`：登录状态与剩余积分（`--json` 输出机器可读格式；另有 `doctor` 诊断、`logout` 清理凭据）。`desktop` profile 由桌面 App 独占管理，CLI（含 `exec`）一律不可用。

默认操作国内版；加 `--provider workbuddy-ai` 操作国际版：

```sh
dsh plugin --profile web exec dsh-workbuddy-connect status --provider workbuddy-ai
dsh plugin --profile web exec dsh-workbuddy-connect doctor --provider workbuddy-ai
```

> 已在 pnpm profile 中安装的插件，其 `exec` 可能无法解析宿主包（报 `ERR_MODULE_NOT_FOUND: @deepseek-ai/...`）：插件的宿主依赖由 DSH 本体在运行时提供，`pnpm exec` 拿不到。宿主内的正常使用不受影响。

`logout` 只删除该版插件自留的凭据副本，不动桌面 App 自己的登录，也不承诺一定让模型分组消失。

## 凭据解密与内置密钥（本 fork 新增）

WorkBuddy 5.6+ 把 `auth.accessToken` / `auth.refreshToken` 加密落盘，密钥来自 App 自己的私有绑定：

```js
process._linkedBinding('electron_browser_workbuddy_storage').loggerGet()
// → {"version":1,"atRestSecretKey":"Sik9U5aXhCdwTVEwsEySDOmDoB9r9ntFxHF1fst9LQI=",...}
```

上游的做法是**启动 App 自带的 Electron** 去取这个值，于是必须有 WorkBuddy 桌面 App 才能解密。但该绑定**只在 macOS / Windows 有自动定位**；Linux（含容器）直接返回 `undefined`，报错：

```text
no WorkBuddy Electron binary is configured for this platform;
set WORKBUDDY_ELECTRON_BIN to the app's Electron binary
```

**本 fork 因此把该密钥作为内置回退值写入插件**，使解密不再依赖 App 的存在：

- **优先级**：先尝试从 App 获取（这是唯一能跟上上游更换密钥的路径）；仅当 App 无法访问，**或 App 返回的密钥打不开当前信封时**，才使用内置值。判定依据是 **keyId 是否匹配**，而不是"是否成功启动了 App"——同一台机器上可能同时存在由不同 WorkBuddy 版本写下的凭据文件。
- **派生链**：`protectorKey = sha256(atRestSecretKey 的 UTF-8 字节)`（32 字节）→ `keyId = sha256(protectorKey).hex[:16]`。本内置值派生出 `keyId = 9127dea1b44020a7`，与真实 5.6.x 凭据内的 `keyId` 一致。
- **解密**：AES-256-GCM；AAD 54 字节，长度前缀为**大端**（`writeUInt32BE`）——写成小端会得到 `Unsupported state or unable to authenticate data`，容易被误判为密钥错误。
- **关闭回退**：把 provider 的 `embeddedKeyPolicy` 设为 `'disabled'`，即恢复"必须有可达的 WorkBuddy 二进制"的严格行为。

> **⚠️ 安全说明（请务必阅读）**：这个密钥是 **WorkBuddy 客户端内置的固定公开常量**，不是每台机器/每个用户独有的秘密——任何装有 WorkBuddy 的机器都能读出同一个值。把它写进插件**并没有新增泄露面**，但也意味着插件的这层保护是**格式，而非机密性**：**拿到该常量 + 任意一份凭据文件，就能解出其中的 token**。请按"凭据文件一旦泄露即等同于 token 泄露"来处理。

## 已知限制

- 在 macOS 的 DSH Web / Desktop / TUI 下验证通过（0.3.2 起要求 `0.1.5-rc.1`+、Node 22+）。Windows 会依次探测 Local 与 Roaming AppData；WSL 会优先从挂载的 Windows 用户目录读取登录凭据。若 Windows 与 Linux 用户名不同且 Windows 环境变量未传入 WSL，请通过 `WORKBUDDY_AUTH_FILE`（国际版为 `WORKBUDDY_AI_AUTH_FILE`）指定实际位置。
- **加密桌面凭据的解密程序定位**：国内版与国际版在 macOS 使用各自的默认路径与 App 发现；Windows 上国内版先检查 `%LOCALAPPDATA%\Programs\WorkBuddy\WorkBuddy.exe` 再查卸载注册表记录，国际版仅查注册表记录。两个产品只按各自的 App 身份定位与执行解密程序，不会互相误选。若自动定位不可用，可按产品设置环境变量：国内版 `WORKBUDDY_ELECTRON_BIN`、国际版 `WORKBUDDY_AI_ELECTRON_BIN`（两变量自 0.6.4 起分离），设置后需完全退出并重启 DSH。Linux 没有内置自动定位；失败时卡片提供 Agent Assist。
- **国际版的模型目录来自 App 界面接口**：服务端按 User-Agent 分流下发，属私有实现，上游改动可能使其失效。届时插件按「本账号上次成功目录 → 内置目录」降级，并在卡片上标明来源与失败原因，但不能保证长期兼容。国内版目录走官方 CLI 同款接口，不受此影响。
- **国际版仍未覆盖的环境**：Windows / WSL / Linux 下国际版 App 的版本读取尚未找到可靠来源，会退回最近保存的版本或内置值。
- **无凭据时的行为变化**：某版 App 从未登录、也没留下插件自留副本时，该版模型分组不再显示。
- **企业账号积分目前仅覆盖国内版**：国际版企业账号的计费接口尚未验证，仍按个人版接口读取。
- 依赖 WorkBuddy 客户端接口（非官方开放 API），WorkBuddy 更新后插件可能需要随之调整。

## 免责声明

- 本项目**仅供个人学习和研究使用**，仅驱动使用者自己的 WorkBuddy 账号在本机调用，请勿用于商业用途或超出个人合理使用的场景。
- 使用者需遵守 WorkBuddy 的服务条款；因使用本项目产生的任何后果（包括但不限于账号被限制、额度被清空、服务中断），由使用者自行承担。
- 本项目作者不对任何因使用或滥用本项目产生的直接或间接损失负责。
- 本项目与腾讯、WorkBuddy、DeepSeek 均无关联，未获其授权或认可；文中出现的名称仅用于描述兼容关系，其商标权利归各自所有。

## 致谢

- [corrinehu/dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect)（MIT）— 本 fork 的上游项目。
- [dingminhua/dsh-connect-workbuddy](https://github.com/dingminhua/dsh-connect-workbuddy)（MIT）— 账号池实现的参照。
- [Sliverkiss/workbuddy2api](https://github.com/Sliverkiss/workbuddy2api)（MIT）— WorkBuddy 上游协议的参照实现。
- [franksong2702/dsh-codex-connect](https://github.com/franksong2702/dsh-codex-connect)（Apache-2.0）— DSH 插件结构与 provider 注册的参照。

## 许可证

[MIT](./LICENSE)
