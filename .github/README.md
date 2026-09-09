# EasyEDA 扩展 CI 配置

本目录为 `easyeda/eext-*` 仓库提供统一的构建、PR 检查、发布和协作模板。CI 由 `.github/ci.json` 控制；默认关闭自动发布、开启 PR 构建检查。

## 文件路径

```text
.github/
├── workflows/
│   ├── build.yml                   # Push 构建、分包和 Release
│   └── pr-check.yml                # Pull Request 构建检查
├── ISSUE_TEMPLATE/
│   ├── bug_report.yml              # Bug 报告模板
│   ├── feature_request.yml         # 功能建议模板
│   └── config.yml                  # Issue 模板入口配置
├── ci.json                         # CI 配置文件
├── README.md                       # 本说明
├── CONTRIBUTING.md                 # 贡献指南
├── SUPPORT.md                      # 支持与反馈说明
├── CODE_OF_CONDUCT.md              # 社区行为准则
└── PULL_REQUEST_TEMPLATE.md        # Pull Request 模板
```

项目中与多语言构建相关的默认路径：

```text
README.md                            # 当前默认语言 README
README_zh.md / README.zh.md          # 中文 README 候选
README_EN.md / README_en.md          # 英文 README 候选
extension.json                      # 扩展名称、版本和描述
locales/extensionJson/zh-Hans.json  # 中文字段翻译
locales/extensionJson/en.json       # 英文字段翻译
build/dist/                         # 默认 .eext 输出目录
```

## 完整配置

路径：`.github/ci.json`

```json
{
  "enabled": false,
  "pr_check": {
    "enabled": true,
    "trigger": "manual",
    "locales": ["zh-cn", "global"]
  },
  "locales": {
    "build": ["zh-cn", "global"],
    "zh-cn": {
      "readme": {
        "auto_detect": true,
        "cjk_threshold": 10,
        "match": [
          "README_zh.md",
          "README.zh.md",
          "README_zh-*.md",
          "README.zh-*.md"
        ]
      },
      "i18n": "locales/extensionJson/zh-Hans.json"
    },
    "global": {
      "readme": {
        "auto_detect": true,
        "cjk_threshold": 10,
        "match": [
          "README_EN.md",
          "README_en.md",
          "README.en.md",
          "README_EN-*.md",
          "README_en-*.md",
          "README.en-*.md"
        ]
      },
      "i18n": "locales/extensionJson/en.json"
    }
  },
  "node_version": "22",
  "build_command": null,
  "build_output_dir": "build/dist",
  "branches": ["main", "master"],
  "release": true,
  "changelog": true
}
```

## 字段说明

### 通用与发布

| 路径 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabled` | boolean | `false` | Push 构建与发布总开关 |
| `node_version` | string | `"22"` | GitHub Actions 使用的 Node.js 版本 |
| `build_command` | string/null | `null` | 自定义构建命令；为空时运行项目构建脚本并自动兼容 ESM/CJS |
| `build_output_dir` | string | `"build/dist"` | `.eext` 构建产物目录 |
| `branches` | string[] | `["main", "master"]` | 允许执行发布构建的分支 |
| `release` | boolean | `true` | 是否创建版本标签和 GitHub Release |
| `changelog` | boolean | `true` | 是否从 `CHANGELOG.md` 提取当前版本的 Release Notes |

### PR 检查

| 路径 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `pr_check.enabled` | boolean | `true` | 是否启用 PR 构建检查 |
| `pr_check.trigger` | string | `"auto"` | `auto` 为 PR 自动检查；`manual` 仅允许 Actions 手动运行 |
| `pr_check.locales` | string[] | `["zh-cn", "global"]` | PR 中需要构建验证的语言包 |

### 多语言分包

| 路径 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `locales.build` | string[] | `["zh-cn", "global"]` | 发布时构建的语言包；支持 `zh-cn`、`global` |
| `locales.zh-cn.readme.auto_detect` | boolean | `true` | README 自动识别兼容字段；当前工作流固定执行语言检测 |
| `locales.zh-cn.readme.cjk_threshold` | integer | `10` | `README.md` 中文字符数超过该值时判定为中文 |
| `locales.zh-cn.readme.match` | string[] | 见完整配置 | 中文 README 候选路径，按顺序匹配，支持 glob |
| `locales.zh-cn.i18n` | string | `locales/extensionJson/zh-Hans.json` | 中文 `extension.json` 翻译文件路径 |
| `locales.global.readme.auto_detect` | boolean | `true` | README 自动识别兼容字段；当前工作流固定执行语言检测 |
| `locales.global.readme.cjk_threshold` | integer | `10` | 保留的完整配置字段；当前检测统一使用中文配置中的阈值 |
| `locales.global.readme.match` | string[] | 见完整配置 | 英文 README 候选路径，按顺序匹配，支持 glob |
| `locales.global.i18n` | string | `locales/extensionJson/en.json` | 英文 `extension.json` 翻译文件路径 |

`locales` 也兼容简写数组，例如 `"locales": ["zh-cn", "global"]`；使用简写时，README 与 i18n 路径采用上述默认值。


## 注意事项

- `enabled: false` 只关闭 Push 发布，不影响独立的 `pr_check.enabled`。
- `build_output_dir` 必须与项目实际输出目录一致。
- `build_command` 会直接执行，仅填写仓库可信命令。
- README 匹配按数组顺序取第一个结果；找不到目标语言 README 时复制当前基础包。
- i18n 文件不存在时不会替换 `extension.json`，但构建仍继续。
- 批量推送时，`build.yml` 会按内容更新；其余 `.github` 文件只在目标仓库不存在时添加，不覆盖仓库自定义内容。
