# 纯离线阻抗校准：实现与复现

本版本以 [嘉立创官网计算器](https://jlcpcb.com/hk/pcb-impedance-calculator) 的 2026-08-31/09-01 计算快照和 2026-09-03 可选工艺查询为基准。只有开发采样脚本联网；插件运行时使用随包附带的叠层、工艺配置、RBF 系数和官网反算尺寸点。没有代理、后台服务、远程模型下载或自动安装。

## 当前交付与边界

- `src/core/jlc-offline.ts` 是界面、采样器和测试共用的叠层解析、工艺映射、正算及尺寸反算入口。`iframe/jlc-core.js` 由它构建，界面不再维护第二套阻抗算法。
- `fixtures/calibration/REPORT.md` 是本次数据生成的结果摘要；`REFINEMENT.md` 对比本轮问题区域修正前后的全部已测点最大误差；`validation-report.json` 列出每个参数路径、独立正算点和官网反算对比；`coverage-report.json` 按全部 4864 个内置及新增叠层列出匹配、筛选、不支持和未采样情况。
- 全部 12 种模式具备执行和采样能力，但**不代表全部叠层、间距、参考层组合已完成精度验收**。RBF 会自动使用样本中实际变化的 W1、S1、D1 特征，并保存各参数的验证边界；固定线距旧样本的 S1/D1 边界为单点，不能冒充完整范围。
- 新模型只使用本次有原始请求和响应的样本训练。旧数据及旧 RBF 保留供未验证估算和历史回归使用，其测试成绩不计入新模型精度报告。
- 官网反算样本不参与正算 RBF 训练。精确匹配几何、目标、互补关系和初始 W1，且正算与最终残差均通过时，运行时直接使用独立采集的官网线宽锚点；因此该点的离线线宽与官网一致。未测目标或初始值仍标为“未验证”，不宣称反算在所有目标上泛化。
- 已验证方案可自动推荐；未验证方案只能人工查看估算与规则预览，不能直接应用。无解、无效参数和不支持叠层显示原因。修改计算参数后，旧方案不能写入 PCB。
- “已验证”仅指列明的官网模型一致性，不是 PCB 制造后的阻抗公差保证。

## 几何和工艺约定

叠层物理尺寸单位为 mm，官网模型输入单位为 mil。mm 转 mil 及几何特征保留四位小数，结果 W1 按网页保留两位。外层 1 oz 的计算 T1 为 1.6 mil、W1−W2 为 0.5 mil、C1/C3 为 1 mil、C2 为 0.6 mil；2 oz 的补偿和防焊值另行取工艺快照。叠层图显示的物理铜厚不用于替代 T1。

Er 采用本次官网模式参数的默认值。网站代码中存在介质加权 Er 方法，但当前计算入口没有使用它。内层 H1 在芯板侧，H2 为另一侧介质跨度加信号铜厚；铜箔方向按官网层压区段判定，缺少区段时采用板中心。跨越非相邻参考层时计入中间铜层。裸芯板不产生额外铜层，不再通过删除铜层或合并结构来凑层数。其记录附带的 top/bottom 厚度仅按官网 computedFinalThinkness 加入 calculationGaps；物理 gaps 与铜层数量保持独立。此项修复了 8 个模板累计 0.0304 mm 的计算跨度偏差。`audit-jlc-stack-geometry.mjs` 直接调用冻结网页中的纯函数，验证所有可解析模板的参考跨度与内层方向。

互补路径在每次正算和求根时保持 `W1+S1`、`W1+2*D1` 不变。不同的互补关系、固定间距和防焊配置使用不同校准键。求解检查有效尺寸、可达性、有限数与舍入后阻抗残差；边界不是默认成功结果。

网页/接口历史基准见 `page-oracle.json`：4 层、1.6 mm、外铜 1 oz、内铜 0.5 oz、L1→L2、50 Ω、互补关闭，3313A 为 13.57 mil，7628 为 14.12 mil。两者仍在官网可选列表中。旧版本误把返回记录的 `usePurpose` 字段当成可生产标志，导致错误排除；现已改为按网页完整请求和显示过滤规则保存的名单。2026-09-03 网页复核：8 层 1.6 mm、外铜 1 oz、内铜 0.5 oz 显示 14 个工艺，3313 的 50 Ω 线宽为 5.94 mil。官网可选不等于对某个订单的制造承诺。接口反算使用 `W2_模式名`、MinW2=2、MaxW2=150、ZoTol=0.5。

从原始响应推导出的官网流程仍用于未采样点估算：先计算初始宽度，随后选择 `[MinW2,初始W2]` 或 `[初始W2,MaxW2]` 二分，阻抗绝对差不超过 0.5 Ω 时结束。网页虽将 ZoTol 标作百分比，本次接口行为符合绝对差，例如 20 Ω 可返回约 19.50 Ω。插件额外要求官网锚点处的正算误差和目标残差均 ≤1%；不满足时保持未验证。界面不再把结果写回初始 W1 输入，避免第二次计算悄悄改变搜索基准。

`node scripts/check-jlc-page-baselines.mjs` 可以重新请求接口、核对已冻结网页基准，并保留复核结果，不覆盖黄金数据。修改工艺快照后必须先重新观察网页并更新基准版本。

## 从已有快照复现

本次使用 Node 24.14.0、Python 3.14.3。在项目根目录执行。首次 npm/pip 安装需要联网或本地依赖缓存；依赖准备完成后的训练、审核、测试、构建以及插件运行均可断网：

```powershell
npm ci
python -m venv .venv-calibration
& .\.venv-calibration\Scripts\python.exe -m pip install -r requirements-calibration.txt
& .\.venv-calibration\Scripts\python.exe scripts/train-jlc-calibration.py
node scripts/validate-jlc-calibration.mjs
node scripts/report-jlc-refinement.mjs
node scripts/build-jlc-core.mjs
node scripts/audit-jlc-stack-geometry.mjs
node scripts/audit-jlc-calibration.mjs
npm test
npx tsc --noEmit --incremental false
npm run build
node scripts/verify-jlc-package.mjs
```

构建包输出到 `build/dist/eext-design-rule-generator_v1.8.8.eext`。打包排除原始采样、Python 环境、脚本、开发网页和测试文件。训练器选型只看固定调参集；最终误差用导出的 JavaScript 系数重新计算。每个路径至少需要 16 个训练点和 6 个独立测试点，当前常规设计为 21 个训练、4 个调参、6 个测试点。完整几何重复点与镜像等价点去重；各分割固定且互不重叠。不将同路径内插值成绩称为跨叠层泛化成绩。当前官网生产模板和全部合法参考层组合会进入覆盖清单；采样命令可重复执行，完整请求已采集或被官网明确拒绝的区域会被跳过并自动续采下一批；拒绝记录不算通过精度验证。

## 更新官网数据（仅开发机联网）

```powershell
node scripts/snapshot-jlc-calibration.mjs
node scripts/snapshot-jlc-templates.mjs
node scripts/snapshot-jlc-availability.mjs --refresh
node scripts/sync-jlc-visible-templates.mjs
node scripts/derive-jlc-template-process.mjs
node scripts/audit-jlc-stack-geometry.mjs
node scripts/collect-jlc-calibration.mjs --inventory-only
node scripts/collect-jlc-calibration.mjs --inventory-only --linked
node scripts/collect-jlc-calibration.mjs --regions 48
node scripts/collect-jlc-calibration.mjs --linked --regions 9
node scripts/collect-jlc-calibration.mjs --thick --regions 12
node scripts/collect-jlc-calibration.mjs --spacing-grid --template JLC081611-2116D --regions 9
# 或重复运行一个会自动续采、训练、验证和审核的安全批次
npm run calibration:optimize -- --regions 12
# 定向补采某个官网生产模板
npm run calibration:optimize -- --template JLC081611-2116D --regions 12
```

更新工艺版本后，先在网页重做 `page-oracle.json` 基准，确认完整参数、反算标记、容差和显示值一致，再批量采样。不要为了通过校验而改写官网结果。快照目录包含公开 API 原始响应；不需要账号、cookie 或令牌。旧 `capture-jlc-impedance-fixtures.mjs` 只保留历史测试兼容，新采样使用上述入口。

可选名单按完整板参数查询并保存全部 720 组原始响应；--refresh 建立新的快照目录，默认执行断点续采，不覆盖历史证据。同步脚本保留旧模板原始备份，同时添加官网新增条目和更新结构。

官网叠层及分页原始响应保存为 `templates-snapshot.json.gz` 和 `template-pages/*.json.gz`，无损压缩，不丢弃原始字段。审核脚本同时检查压缩文件哈希、解压后的内容摘要、采样参数分组与请求/响应关联。

采样器默认串行，同一实例请求起点间隔至少 500 ms，先等 WebSocket open 再发 HTTP 请求，同时支持 HTTP 直接结果和 WS 推送。每条样本保存模式、完整请求、请求标识、参数摘要、原始响应、时间、来源及工艺版本。已从原始响应推导并对全部历史样本逐条验证 `paramMd5 = MD5(模式名 + 参数按原顺序组成的 Java Map 文本)`。新请求在发送前计算该摘要，响应必须匹配请求标识、模式与摘要，避免为摘要校验重复请求。该规则是实测推导，不是官网公开接口承诺；历史同参数重放证据完整保留，摘要规则变更时仍会触发复核。

`samples.jsonl` 为追加式断点文件，样本 ID 由版本、模式和完整参数生成。重复执行跳过已有样本。失败写入 `failures.jsonl`，超时退避重试；HTTP 403/429 立即暂停，不能循环绕过限流。损坏的 JSONL 行会报错，不会静默丢弃。勿同时运行多个采样进程，以免重复请求和交叉写入。

`--all` 会请求覆盖清单中的全部路径，规模很大，默认不启用。清单枚举每个信号层的全部合法参考层组合（约 149 万个去重路径），以哈希和 gzip 缓存，避免每批重复计算；可以重复运行或增大 `--regions` 断点扩充，已完成区域会自动跳过；`--linked` 单独采集互补路径；`--thick` 优先筛选外铜 2 oz、内铜至少 1 oz。互补采样采用界面默认关系：差分 W1=5.2/S1=5，单端共面 W1=7/D1=8，差分共面 W1=5.2/S1=5/D1=8。其他初始关系必须另行采样，不能套用验证状态。

对正算未达标路径可执行 `--refine` 加入中间训练点后重新训练和验证；固定测试点不会移入训练集。训练完成后运行 `node scripts/audit-jlc-fresh-points.mjs`，每个一维路径采 12 个、多维路径采 32 个内部点并追加每个边界面的新审计点；它们由冻结系数摘要生成，保存到独立文件且永不参与训练。模型系数或边界变化后，旧审计证据自动失效。旧审计点还会作为历史诊断复算，不能因为重训就忽略已知超差。缺少审计、训练点未包含完整参数边界角点，或任一点超出 1% 均不能取得已验证状态。`--spacing-grid --refine` 补入联合网格，三维模型采用 7×5×5 个训练位置，原审计点不会加入训练。未达标时继续显示未验证，门槛不放宽。

## 离线与界面验证

`jlc-iframe.test.ts` 在真实 HTML 和全部界面脚本上注入只读 EDA 模拟，禁用 fetch/WebSocket，验证扫描、两项回归线宽、估算预览、写规则拦截和越界失败。浏览器冒烟测试也只使用只读模拟 PCB，不接触实际工程。独立数据回归运行最终交付的 `jlc-calibration.js`。

原有可选 AI 网络识别功能未删除：用户主动启用 AI 时仍可发送网络名称到其自行配置的服务。该功能与阻抗计算独立；阻抗核心和叠层选择本身没有网络请求。断网测试保持 AI 关闭。
