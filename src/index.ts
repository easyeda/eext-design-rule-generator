/**
 * EasyEDA 自动设计规则扩展入口。
 */
import extensionConfig from '../extension.json' with { type: 'json' };

// eslint-disable-next-line unused-imports/no-unused-vars
export function activate(status?: 'onStartupFinished', arg?: string): void {}

export async function openRuleWorkbench(): Promise<void> {
	await eda.sys_IFrame.openIFrame('/iframe/index.html', 1240, 780, 'adr-rule-workbench', {
		title: eda.sys_I18n.text('Auto Design Rules'),
		maximizeButton: true,
		minimizeButton: true,
		minimizeStyle: 'constricted',
	});
}

export async function restoreRuleBackup(): Promise<void> {
	await eda.sys_IFrame.openIFrame('/iframe/index.html', 1240, 780, 'adr-rule-workbench', {
		title: eda.sys_I18n.text('Auto Design Rules'),
		maximizeButton: true,
		minimizeButton: true,
	});
	eda.sys_Message.showToastMessage(eda.sys_I18n.text('Use the restore button in the workbench'));
}

export function about(): void {
	eda.sys_Dialog.showInformationMessage(
		`${eda.sys_I18n.text('Auto Design Rules')} v${extensionConfig.version}\n${eda.sys_I18n.text('Offline impedance and named-net rule assignment')}`,
		eda.sys_I18n.text('About'),
	);
}
