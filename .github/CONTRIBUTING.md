# 贡献指南 / Contributing Guide

感谢你为本项目贡献代码、文档或建议。提交贡献即表示你同意遵守本项目的行为准则。

Thank you for contributing code, documentation, or ideas. By participating, you agree to follow this project's Code of Conduct.

## 开始之前 / Before You Start

- 搜索现有 Issue 和 Pull Request，避免重复工作。
- Bug 请提供复现步骤、预期行为、实际行为和运行环境。
- 较大的功能或不兼容变更，请先创建 Issue 讨论方案。

- Search existing issues and pull requests before starting.
- For bugs, include reproduction steps, expected behavior, actual behavior, and environment details.
- Open an issue before implementing large features or breaking changes.

## 本地开发 / Local Development

1. Fork 并克隆仓库。
2. 从默认分支创建独立分支。
3. 使用项目锁文件对应的包管理器安装依赖。
4. 完成修改后运行仓库提供的测试、lint 和构建命令。
5. 确认生成的 `.eext` 能正确安装并验证相关功能。

1. Fork and clone the repository.
2. Create a focused branch from the default branch.
3. Install dependencies with the package manager matching the lockfile.
4. Run the repository's tests, lint checks, and build command after your changes.
5. Confirm the generated `.eext` installs correctly and test the affected functionality.


## 提交要求 / Submission Requirements

- 每个 PR 聚焦一个问题，避免无关重构或格式化。
- 保持现有代码风格，并为行为变化补充或更新测试。
- 不要提交密钥、Token、账号信息、构建产物或 `node_modules`。
- 用户可见的变化应更新 README、文档或 CHANGELOG（如适用）。
- Commit 和 PR 标题应简洁说明改动目的。

- Keep each pull request focused and avoid unrelated refactors or formatting.
- Follow the existing code style and add or update tests for behavior changes.
- Never commit secrets, tokens, account data, build artifacts, or `node_modules`.
- Update the README, documentation, or changelog for user-visible changes when applicable.
- Use concise commit messages and pull request titles that explain the intent.

## Pull Request 检查 / Pull Request Checklist

提交 PR 前请确认：

- [ ] 本地构建成功
- [ ] 相关测试和检查通过
- [ ] 已验证受影响的扩展功能
- [ ] 没有提交敏感信息或无关文件
- [ ] 已补充必要的文档和截图
- [ ] PR 描述包含测试方法和潜在影响

Before opening a pull request, confirm that:

- [ ] The project builds locally
- [ ] Relevant tests and lint checks pass
- [ ] Affected extension functionality has been verified
- [ ] No sensitive or unrelated files are included
- [ ] Required documentation and screenshots are included
- [ ] The PR describes testing and potential impact

维护者可能要求修改、补充测试，或在方案不适合项目方向时关闭 PR。所有反馈应保持专业和尊重。

Maintainers may request changes or additional tests, or close a pull request that does not fit the project direction. Keep all discussion professional and respectful.
