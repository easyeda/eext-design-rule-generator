(() => {
	'use strict';
	const $ = selector => document.querySelector(selector);
	const api = globalThis.eda;
	const impedanceCore = globalThis.ADR_JLC;
	const calibration = globalThis.__ADR_JLC_CALIBRATION__;
	if (!impedanceCore || !calibration) throw new Error('离线阻抗核心或校准数据未加载');
	const state = { snapshot: null, classified: [], plan: null, stackups: globalThis.__ADR_STACKUPS__ || [], evaluations: [], selected: null, filter: 'all', netClasses: [], coplanar: { enabled: false, distanceMil: 20 }, aiInputs: [] };
	const toast = (message, error = false) => { const element = $('#toast'); element.textContent = message; element.className = `toast show${error ? ' error' : ''}`; setTimeout(() => { element.className = 'toast'; }, 3200); };
	const adrLog = (stage, data) => { const payload = data === undefined ? '' : data; console.log(`[ADR][${stage}]`, payload); return payload; };
	const adrError = (stage, error) => { console.error(`[ADR][${stage}]`, error); };
	const number = id => Number($(`#${id}`).value);
	const updateThicknessOptions = () => {
		const layers = number('layers'), opts = (globalThis.__ADR_LAYER_THICKNESS__ || {})[String(layers)] || [1.6], sel = $('#thickness'), prev = Number(sel.value);
		sel.innerHTML = opts.map(t => `<option value="${t}">${t}</option>`).join('');
		sel.value = opts.includes(prev) ? String(prev) : String(opts.includes(1.6) ? 1.6 : opts[0]);
	};
	function stackPreviewTemplates() {
		const matches = state.stackups.filter(item => item.boardType === number('boardType') && item.layers === number('layers') && Math.abs(item.thickness - number('thickness')) < .001 && (item.layers === 2 || Math.abs(item.innerOz - number('innerOz')) < .001) && Math.abs(item.outerOz - number('outerOz')) < .001 && impedanceCore.isProductionTemplate(item));
		return matches.map(templateToStack).filter(Boolean);
	}
	function renderStackPreview() {
		const box = $('#stackPreview');
		if (!box) return;
		const stacks = stackPreviewTemplates();
		const select = $('#stackTemplate'), previous = select?.value;
		if (select) {
			select.innerHTML = stacks.length ? stacks.map(item => `<option value="${item.template.id}">${item.template.code} · ${item.template.name}</option>`).join('') : '<option value="">无精确匹配</option>';
			if (stacks.some(item => item.template.id === previous)) select.value = previous;
		}
		const layers = number('layers'), previousRoles = new Map([...document.querySelectorAll('.layer-role-select')].map(item => [Number(item.dataset.layer), item.value]));
		const roleNames = { signal: '信号层', power: '电源层', ground: '地层' };
		const roleColors = { signal: '#2563eb', power: '#d97706', ground: '#059669' };
		const defaultRole = (layer) => {
			if (previousRoles.has(layer)) return previousRoles.get(layer);
			if (layer === 1 || layer === layers) return 'signal';
			if (layer === 2 || layer === layers - 1) return 'ground';
			if (layer === Math.ceil(layers / 2)) return 'power';
			return layer % 3 === 0 ? 'power' : layer % 2 === 0 ? 'ground' : 'signal';
		};
		const rowH = 24, h = Math.max(92, 34 + layers * rowH), svgRows = [], controls = [];
		for (let layer = 1; layer <= layers; layer++) {
			const role = defaultRole(layer), y = 18 + (layer - 1) * rowH;
			svgRows.push(`<rect x="76" y="${y}" width="340" height="12" rx="2" fill="${roleColors[role]}" opacity=".88"/><text x="18" y="${y + 10}" font-size="10" fill="#1a2744">L${layer}</text><text x="426" y="${y + 10}" font-size="10" fill="#6b7a99">${roleNames[role]}</text>`);
			if (layer < layers) svgRows.push(`<rect x="76" y="${y + 12}" width="340" height="12" fill="#dbeafe" opacity=".75"/>`);
			controls.push(`<label>L${layer}<select class="layer-role-select" data-layer="${layer}"><option value="signal"${role === 'signal' ? ' selected' : ''}>信号层</option><option value="power"${role === 'power' ? ' selected' : ''}>电源层</option><option value="ground"${role === 'ground' ? ' selected' : ''}>地层</option></select></label>`);
		}
		const official = stacks[0] ? `${stacks.length} 个官方叠层候选 · ${stacks[0].template.thickness}mm` : '当前板厚/铜厚无官方叠层候选';
		box.innerHTML = `<div class="stack-preview-head"><b>${layers} 层结构配置</b><span>${official}</span></div><div class="stack-role-layout"><svg viewBox="0 0 560 ${h}" role="img" aria-label="信号电源地叠层结构示意图">${svgRows.join('')}</svg><div class="layer-role-grid">${controls.join('')}</div></div>`;
		box.querySelectorAll('.layer-role-select').forEach(item => item.addEventListener('change', () => { renderStackPreview(); if (state.classified.length) renderImpedanceInputs(); }));
	}
	updateThicknessOptions();
	const status = (title, detail) => { $('#statusTitle').textContent = title; $('#statusDetail').textContent = detail; };
	const setProgress = (label, pct) => { const wrap = $('#progressWrap'); wrap.hidden = pct >= 100 || pct <= 0; $('#progressLabel').textContent = label; $('#progressFill').style.width = `${Math.min(100, Math.max(0, pct))}%`; $('#progressPct').textContent = `${Math.round(pct)}%`; };
	const profileNumber = value => String(Math.round(value * 100) / 100).replace('.', '_');
	const configurationNamePart = (value, fallback) => String(value || fallback).trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').slice(0, 60) || fallback;
	const projectBoardConfigurationName = (project, board) => `${configurationNamePart(project?.friendlyName || project?.name, '未命名工程')}-${configurationNamePart(board?.name || board?.pcb?.name, '未命名板子')}`;
	const defaultRuleColor = { r: 0, g: 0, b: 0, alpha: 1 };
	const highContrastColors = [
		{ r: 230, g: 25, b: 75, alpha: 1 }, { r: 0, g: 130, b: 200, alpha: 1 },
		{ r: 60, g: 180, b: 75, alpha: 1 }, { r: 245, g: 130, b: 48, alpha: 1 },
		{ r: 145, g: 30, b: 180, alpha: 1 }, { r: 0, g: 160, b: 160, alpha: 1 },
		{ r: 240, g: 50, b: 230, alpha: 1 }, { r: 170, g: 110, b: 40, alpha: 1 },
		{ r: 0, g: 80, b: 255, alpha: 1 }, { r: 128, g: 0, b: 0, alpha: 1 },
	];
	const colorHex = color => `#${[color.r, color.g, color.b].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
	const colorSeed = value => [...value].reduce((hash, char) => ((hash * 33) ^ char.charCodeAt(0)) >>> 0, 5381);
	function ruleColor(index, offset) {
		if (!$('#autoRuleColors')?.checked) return { ...defaultRuleColor };
		return { ...highContrastColors[(offset + index) % highContrastColors.length] };
	}
	function patchDifferentialRuleBindings(source, bindings) {
		const newline = String(source ?? '').includes('\r\n') ? '\r\n' : '\n';
		const lines = String(source ?? '').split(/\r?\n/);
		const changes = [], matched = [], missing = [];
		const wanted = new Map(bindings.flatMap(binding => binding.netNames.map(net => [String(net), binding.profileName])));
		for (let index = 0; index < lines.length; index++) {
			const line = lines[index];
			if (!line.includes('"type":"RULE_SELECTOR"')) continue;
			const separator = line.indexOf('||');
			if (separator < 0) continue;
			try {
				const header = JSON.parse(line.slice(0, separator));
				const selector = JSON.parse(header.id);
				const netName = selector?.[0] === 'RULE_SELECTOR' && selector?.[1]?.[0] === 'NET' ? String(selector[1][1]) : '';
				const profileName = wanted.get(netName);
				if (!profileName) continue;
				const hasTrailingPipe = line.endsWith('|');
				const payloadText = line.slice(separator + 2, hasTrailingPipe ? -1 : undefined);
				const payload = JSON.parse(payloadText);
				payload.ruleKeyValue ||= {};
				matched.push({ net: netName, profileName });
				if (payload.ruleKeyValue.DIFFER_ENTAIL !== profileName) {
					payload.ruleKeyValue.DIFFER_ENTAIL = profileName;
					lines[index] = `${line.slice(0, separator + 2)}${JSON.stringify(payload)}${hasTrailingPipe ? '|' : ''}`;
					changes.push({ net: netName, profileName });
				}
			} catch { /* Ignore unrelated or malformed source records. */ }
		}
		const matchedNets = new Set(matched.map(item => item.net));
		for (const netName of wanted.keys()) if (!matchedNets.has(netName)) missing.push(netName);
		return { text: lines.join(newline), changes, matched, missing };
	}
	globalThis.__ADR_TEST__ = { ...(globalThis.__ADR_TEST__ || {}), patchDifferentialRuleBindings, projectBoardConfigurationName };

	function classify(nets) {
		const set = new Set(nets);
		const rules = customRules();
		return nets.map((net) => {
			const custom = rules.find(rule => new RegExp(rule.pattern, 'i').test(net));
			if (custom) {
				if (custom.kind === 'differential') {
					const positive = custom.positiveSuffix, negative = custom.negativeSuffix;
					if (net.toUpperCase().endsWith(positive.toUpperCase())) { const stem = net.slice(0, -positive.length), mate = stem + negative; if (set.has(mate)) return { net, category: 'differential', targetOhms: custom.targetOhms, mate, polarity: 'positive', pairName: stem + '_D', warnings: [] }; }
					if (net.toUpperCase().endsWith(negative.toUpperCase())) { const stem = net.slice(0, -negative.length), mate = stem + positive; if (set.has(mate)) return { net, category: 'differential', targetOhms: custom.targetOhms, mate, polarity: 'negative', pairName: stem + '_D', warnings: [] }; }
					return { net, category: 'signal', warnings: ['自定义差分规则未匹配到伙伴'] };
				}
				return { net, category: custom.kind === 'power' ? 'power' : custom.kind === 'ground' ? 'ground' : 'impedance', targetOhms: custom.kind === 'impedance' ? custom.targetOhms : undefined, warnings: [] };
			}
			if (/^(?:GND|AGND|DGND|PGND|GNDA|GNDD)(?:$|[_-])/i.test(net)) return { net, category: 'ground', warnings: [] };
			if (/(?:^|[_+-])(?:\d+(?:V\d+|V)|VCC|VDD|VSS|VBAT|VIN|VOUT|AVDD|DVDD|PVDD|VBUS|VUSB|VCORE|VDDA|VDDD|VCCA|VSSA|VSYS|VMAIN|VRTC|VIO|VREF|VTT|VPP|VEE|VNN|VPOS|VNEG|PWR|POWER)(?:$|[_-])/i.test(net)) return { net, category: 'power', warnings: [] };
			const tag = net.match(/(?:^|_)Z(\d{2,3})D?(?:_|$)/i);
			const suffixes = [['_DP', '_DM', '_D'], ['_P', '_N', ''], ['P', 'N', ''], ['+', '-', '']];
			const targetFor = name => tag ? Number(tag[1]) : (/(?:PCIE|PCI_E|PEX)/i.test(name) ? 85 : /USB/i.test(name) ? 90 : 100);
			for (const [positive, negative, key] of suffixes) if (net.toUpperCase().endsWith(positive)) { const stem = net.slice(0, -positive.length), mate = stem + negative; if (set.has(mate)) return { net, category: 'differential', targetOhms: targetFor(net), mate, polarity: 'positive', pairName: stem + key, warnings: [] }; }
			for (const [positive, negative, key] of suffixes) if (net.toUpperCase().endsWith(negative)) { const stem = net.slice(0, -negative.length), mate = stem + positive; if (set.has(mate)) return { net, category: 'differential', targetOhms: targetFor(net), mate, polarity: 'negative', pairName: stem + key, warnings: [] }; }
			if (tag) return { net, category: 'impedance', targetOhms: Number(tag[1]), warnings: [] };
			return { net, category: 'signal', warnings: /(?:_P|_N|_DP|_DM|\+|-)$/i.test(net) ? ['未找到差分伙伴'] : [] };
		});
	}
	function customRules() {
		try { return JSON.parse($('#customRules').value || '[]'); } catch { return []; }
	}
	function impedanceInputs() {
		const keys = new Map();
		for (const item of state.classified) if (item.targetOhms) keys.set(`${item.category === 'differential'}:${item.targetOhms}`, { target: item.targetOhms, differential: item.category === 'differential', nets: [] });
		for (const item of state.classified) if (item.targetOhms) keys.get(`${item.category === 'differential'}:${item.targetOhms}`).nets.push(item.net);
		const baseRows = [...keys.values()];
		const refMode = selectedReferenceMode();
		if (refMode === 'custom') return baseRows.map(row => ({ ...row, layerPreset: autoImpedanceLayer() }));
		const roles = selectedLayerRoles();
		const rows = [];
		for (const row of baseRows) {
			for (let layer = 1; layer <= number('layers'); layer++) {
				if (roles[layer] !== 'signal') continue;
				const refs = inferReferences(layer);
				const upperRole = roles[refs.upper], lowerRole = roles[refs.lower];
				if (refMode === 'ground') {
					if (!refs.upper && !refs.lower) continue;
					if (upperRole !== 'ground' && lowerRole !== 'ground') continue;
				}
				rows.push({ ...row, layerPreset: layer, layer, upperPreset: refs.upper, lowerPreset: refs.lower });
			}
		}
		return rows.length ? rows : baseRows.map(row => ({ ...row, layerPreset: autoImpedanceLayer() }));
	}

	const groupId = row => `${row.differential ? 'd' : 's'}_${row.target}_${row.layerPreset || 'x'}`;
	const impedanceModes = impedanceCore.JLC_IMPEDANCE_MODES.map(item => ({ ...item, value: item.type, differential: item.usesS1, coplanar: item.usesD1 }));
	const impedanceMode = value => impedanceModes.find(item => item.value === value) || impedanceModes[0];
	const layerOptions = (selected, allowNone = false) => {
		const layers = Math.max(2, number('layers'));
		const options = allowNone ? '<option value="0">无</option>' : '';
		return options + Array.from({ length: layers }, (_, index) => `<option value="${index + 1}"${index + 1 === selected ? ' selected' : ''}>L${index + 1}</option>`).join('');
	};
	function readImpedanceRows() {
		return [...document.querySelectorAll('#impedanceRows tr[data-group]')].map((tr) => {
			const id = tr.dataset.group;
			const mode = $(`#mode_${id}`).value, modeInfo = impedanceMode(mode);
			const differential = modeInfo.differential, coplanar = modeInfo.coplanar;
			const target = number(`target_${id}`);
			const min = differential ? 50 : 20, max = differential ? 150 : 90;
			if (!Number.isFinite(target) || target < min || target > max) throw new Error(`${differential ? '差分' : '单端/共面单端'}阻抗必须在 ${min}~${max} Ω 范围内`);
			const layer = number(`layer_${id}`), upperRef = number(`upper_${id}`), lowerRef = number(`lower_${id}`);
			if (!layer || (!upperRef && !lowerRef)) throw new Error(`${target} Ω 组必须选择阻抗层和至少一个参考层`);
			if (layer === upperRef || layer === lowerRef) throw new Error(`${target} Ω 组的阻抗层不能同时作为参考层`);
			const gap = differential ? number(`gap_${id}`) : 0;
			if (differential && (!Number.isFinite(gap) || gap < 2.5 || gap > 100)) throw new Error('S1 必须在 2.5～100 mil 内');
			const distance = coplanar ? number(`dist_${id}`) : 0;
			if (coplanar && (!Number.isFinite(distance) || distance < 2.5 || distance > 80)) throw new Error('D1 必须在 2.5～80 mil 内');
			const enteredWidth = number(`width_${id}`);
			if ($(`#width_${id}`).value !== '' && (!Number.isFinite(enteredWidth) || enteredWidth < 2.5 || enteredWidth > 100)) throw new Error('W1 必须为空或在 2.5～100 mil 内');
			const width = enteredWidth || 0;
			return { id, mode, differential, coplanar, target, nets: tr.dataset.nets.split('\u001f'), layer, upperRef, lowerRef, width, gap, distance };
		});
	}
	function renderImpedanceInputs() {
		const rows = impedanceInputs(), body = $('#impedanceRows');
		body.innerHTML = rows.length ? rows.map((row) => {
			const id = groupId(row), preset = (state.aiInputs || []).find(item => item.differential === row.differential && Number(item.target) === row.target);
			const max = row.differential ? 150 : 90;
			const complement = $('#widthGapComplement')?.checked ?? true;
			const defaultLayer = row.layerPreset || autoImpedanceLayer();
			const defaultMode = defaultLayer === 1 || defaultLayer === number('layers') ? (row.differential ? 'DiffEdgeCoupledCoatedMicrostrip1B' : 'CoatedMicrostrip1B') : (row.differential ? 'DiffOffsetStripline1B1A' : 'OffsetStripline1B1A');
			const modeOptions = impedanceModes.map(item => `<option value="${item.value}"${item.value === defaultMode ? ' selected' : ''}>${item.label}</option>`).join('');
			const refs = row.upperPreset || row.lowerPreset ? { upper: row.upperPreset || 0, lower: row.lowerPreset || 0 } : inferReferences(defaultLayer);
			return `<tr data-group="${id}" data-differential="${row.differential ? 1 : 0}" data-nets="${row.nets.join('\u001f')}"><td><select id="mode_${id}">${modeOptions}</select></td><td><input type="number" id="target_${id}" value="${row.target}" step="1" min="${row.differential ? 50 : 20}" max="${max}"></td><td>${row.nets.length} 个网络</td><td><select id="layer_${id}">${layerOptions(defaultLayer)}</select></td><td><select id="upper_${id}">${layerOptions(refs.upper, true)}</select></td><td><select id="lower_${id}">${layerOptions(refs.lower, true)}</select></td><td><input type="number" id="width_${id}" value="${complement && (row.differential || row.coplanar) ? (row.coplanar && !row.differential ? 7 : 5.2) : ''}" step="0.1" min="2.5" max="100" placeholder="留空按 8 mil 起算"></td><td><input type="number" id="gap_${id}" value="${preset?.gap ?? 5}" step="0.1" min="2.5" max="100"></td><td><input type="number" id="dist_${id}" value="${preset?.distance ?? 8}" step="0.1" min="2.5"></td><td><button class="btn danger compact-btn" type="button" data-delete-impedance="${id}">删除</button></td></tr>`;
		}).join('') : '<tr><td colspan="10" class="empty">当前 PCB 未识别到差分或阻抗网络</td></tr>';
		for (const row of rows) {
			const id = groupId(row), mode = body.querySelector(`#mode_${id}`), target = body.querySelector(`#target_${id}`), gap = body.querySelector(`#gap_${id}`), dist = body.querySelector(`#dist_${id}`), width = body.querySelector(`#width_${id}`);
			const updateModeFields = () => { const info = impedanceMode(mode.value), layerSel = $(`#layer_${id}`), upperSel = $(`#upper_${id}`), lowerSel = $(`#lower_${id}`), refMode = selectedReferenceMode(); gap.disabled = !info.differential; dist.disabled = !info.coplanar; gap.closest('td').classList.toggle('field-disabled', !info.differential); dist.closest('td').classList.toggle('field-disabled', !info.coplanar); target.min = info.differential ? '50' : '20'; target.max = info.differential ? '150' : '90'; if (info.layer === 'outer' && ![1, number('layers')].includes(number(`layer_${id}`))) layerSel.value = '1'; if (info.layer === 'inner' && [1, number('layers')].includes(number(`layer_${id}`))) layerSel.value = String(Math.min(2, number('layers') - 1)); if (refMode !== 'custom') { const syncRefs = inferReferences(Number(layerSel.value) || firstSignalLayer()); upperSel.value = syncRefs.upper || '0'; lowerSel.value = syncRefs.lower || '0'; } };
			const complementAdjust = (field, counterpart, delta, factor = 1) => { if (!$('#widthGapComplement').checked || field.disabled || !counterpart || counterpart.disabled) return; const value = Number(counterpart.value) - delta * factor; counterpart.value = String(Math.round(value * 100) / 100); };
			const bindComplement = (field, updates) => { field.addEventListener('focus', () => { field.dataset.complementValue = field.value; }); field.addEventListener('input', () => { const previous = Number(field.dataset.complementValue ?? field.value), current = Number(field.value); if (!Number.isFinite(previous) || !Number.isFinite(current)) return; const delta = current - previous; for (const [counterpart, factor] of updates) complementAdjust(field, counterpart, delta, factor); field.dataset.complementValue = field.value; }); };
			mode.addEventListener('change', updateModeFields); $(`#layer_${id}`).addEventListener('change', updateModeFields); updateModeFields();
			bindComplement(width, [[gap, 1], [dist, 0.5]]);
			bindComplement(gap, [[width, 1], [dist, 0.5]]);
			bindComplement(dist, [[width, 2], [gap, 2]]);
		}
		body.querySelectorAll('[data-delete-impedance]').forEach(button => button.addEventListener('click', () => deleteImpedanceGroup(button.closest('tr'))));
	}
	function deleteImpedanceGroup(row) {
		if (!row) return;
		const nets = String(row.dataset.nets || '').split('\u001f').filter(Boolean);
		for (const net of nets) {
			const item = state.classified.find(entry => entry.net === net);
			if (!item) continue;
			item.category = 'signal';
			delete item.targetOhms; delete item.mate; delete item.polarity; delete item.pairName; delete item.widthMil; delete item.profileName;
			item.warnings = [];
		}
		state.plan = null; state.selected = null; state.evaluations = []; state.calculationSignature = '';
		render(); renderImpedanceInputs();
		$('#planMeta').textContent = '阻抗配置已删除，请重新计算';
		$('#planCards').innerHTML = '<p class="empty small">阻抗配置已变化，请重新计算设计规则</p>';
		$('#ruleMetric').textContent = '0'; $('#netMetric').textContent = '0'; $('#pairMetric').textContent = '0'; $('#warningMetric').textContent = '0';
		$('#ruleCards').innerHTML = '<p class="empty small">暂无规则计划</p>';
		$('#applyBtn').disabled = true;
		toast(`已删除阻抗配置，${nets.length} 个网络恢复为普通信号`);
	}
	function templateToStack(template) {
		try { return impedanceCore.parseStack(template); } catch { return null; }
	}
	function constraints() { return readImpedanceRows(); }
	function calculationSignature() { return JSON.stringify({ rows: readImpedanceRows(), board: ['boardType','layers','thickness','innerOz','outerOz'].map(number), complement: $('#widthGapComplement').checked }); }
	function evaluateStackups() {
		state.plan = null; state.selected = null; state.calculationSignature = ''; $('#applyBtn').disabled = true;
		const constraintsRows = constraints();
		const templates = state.stackups.filter(item => item.boardType === number('boardType') && item.layers === number('layers') && Math.abs(item.thickness - number('thickness')) < .001 && (item.layers === 2 || Math.abs(item.innerOz - number('innerOz')) < .001) && Math.abs(item.outerOz - number('outerOz')) < .001 && impedanceCore.isProductionTemplate(item));
		if (!templates.length) throw new Error('官网快照中没有匹配且结构有效的可选叠层，请检查板厚、层数和铜厚');
		const complement = $('#widthGapComplement')?.checked ?? true;
		const evaluations = [];
		for (const template of templates) {
			let stack;
			try { stack = impedanceCore.parseStack(template); }
			catch (error) { evaluations.push({ stack: { template }, results: [], verified: false, failed: true, reason: error.message, score: Infinity }); continue; }
			const results = constraintsRows.map(row => {
				try { return impedanceCore.calculateRow(stack, row, complement, calibration, globalThis.__ADR_JLC_MODELS__ || {}); }
				catch (error) { return { ...row, status: 'no-solution', verified: false, reason: error.message }; }
			});
			const failed = results.some(row => row.status === 'no-solution');
			const verified = !failed && results.every(row => row.verified);
			const score = failed ? Infinity : results.reduce((sum,row) => sum + Math.abs(row.errorPercent),0) + (template.charge ? 3 : 0);
			evaluations.push({ stack, results, verified, failed, score });
		}
		state.evaluations = evaluations.sort((a,b) => Number(b.verified)-Number(a.verified) || a.score-b.score || a.stack.template.code.localeCompare(b.stack.template.code));
		const select = $('#stackTemplate'), previous = select.value;
		select.innerHTML = state.evaluations.map(item => `<option value="${item.stack.template.id}">${item.stack.template.code} · ${item.verified ? '已验证' : item.failed ? '无解/不支持' : '未验证'}</option>`).join('');
		if (state.evaluations.some(item => item.stack.template.id === previous)) select.value = previous;
		select.disabled = $('#stackMode').value !== 'manual';
		state.selected = $('#stackMode').value === 'manual' ? state.evaluations.find(item => item.stack.template.id === select.value) : state.evaluations.find(item => item.verified);
		if (state.selected) select.value = state.selected.stack.template.id;
		state.calculationSignature = calculationSignature();
		renderStackups();
	}
	const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
	function renderStackups() {
		const chosen = state.selected;
		$('#stackTitle').textContent = chosen ? `${chosen.verified ? '已验证' : chosen.failed ? '无解/不支持' : '未验证·仅供估算'} · ${chosen.stack.template.code}` : '没有通过验证的自动推荐，请手动查看估算';
		$('#stackMeta').textContent = `模型 ${calibration.version} · 工艺 ${impedanceCore.PROCESS.version} · 运行时完全离线`;
		$('#planMeta').textContent = `${state.evaluations.length} 个候选 · ${state.evaluations.filter(item => item.verified).length} 个已验证`;
		$('#planCards').innerHTML = state.evaluations.map(item => `<article class="stack-result${item === chosen ? ' selected' : ''}"><h4>${escapeHtml(item.stack.template.code)} · ${item.verified ? '已验证' : item.failed ? '无解/不支持' : '未验证·仅供估算'}</h4><p>${escapeHtml(item.reason || '')}</p><div class="result-table-wrap"><table class="stack-result-table"><thead><tr><th>模式</th><th>计算 Ω</th><th>信号层 / 参考层</th><th>W1 / mil</th><th>S1 / mil</th><th>D1 / mil</th><th>验证状态</th></tr></thead><tbody>${item.results.map(row => `<tr><td>${escapeHtml(impedanceMode(row.mode).label)}</td><td>${(item.verified || item === chosen) && Number.isFinite(row.calculated) ? row.calculated.toFixed(2) : '—'}</td><td>L${row.layer} / ${escapeHtml(row.reference || '')}</td><td>${row.status === 'no-solution' || (!item.verified && item !== chosen) ? '—' : row.width.toFixed(2)}</td><td>${row.gap && (item.verified || item === chosen) ? row.gap.toFixed(2) : '—'}</td><td>${row.distance && (item.verified || item === chosen) ? row.distance.toFixed(2) : '—'}</td><td>${escapeHtml(row.reason)}<br><small>${escapeHtml(row.calibrationRange || "")}</small></td></tr>`).join('')}</tbody></table></div>${item === chosen || item.failed ? '' : `<button data-stack="${item.stack.template.id}">${item.verified ? '选择此方案' : '查看估算方案'}</button>`}</article>`).join('');
		document.querySelectorAll('[data-stack]').forEach(button => button.addEventListener('click', () => { $('#stackMode').value = 'manual'; $('#stackTemplate').disabled = false; $('#stackTemplate').value = button.dataset.stack; state.selected = state.evaluations.find(item => item.stack.template.id === button.dataset.stack); makePlan(); renderStackups(); $('#applyBtn').disabled = !state.plan || !state.selected?.verified; }));
	}

	function makePlan() {
		if (!state.selected || state.selected.failed) { state.plan = null; render(); return; }
		const resultsByTarget = new Map();
		for (const row of state.selected.results) {
			const key = `${row.differential ? 'd' : 's'}_${row.target}`;
			if (!resultsByTarget.has(key)) resultsByTarget.set(key, []);
			resultsByTarget.get(key).push(row);
		}
		const groups = new Map(), pairs = [];
		const powerWidth = () => { const I = number('pwrCurrent') || 2, dT = number('pwrTempRise') || 20, copperUm = Number($('#pwrCopperOz')?.value) || 35, isExt = $('#pwrLayerType')?.value !== 'internal'; const k = isExt ? 0.048 : 0.024; const f = Math.pow(I / (k * Math.pow(dT, 0.44)), 1 / 0.725); const areaCm2 = f * 2.54 * 2.54 / 1e6; const m = 1e-4 * copperUm; return Math.round(areaCm2 / m / 0.1 / 0.0254 * 100) / 100; };
		for (const item of state.classified) {
			if (item.category === 'signal') continue;
			if (item.category === 'power' || item.category === 'ground') {
				const width = powerWidth(), name = 'PWR';
				if (!groups.has(name)) groups.set(name, { profileName: name, category: 'power', nets: [], widthMil: width, targetOhms: 0, impedanceLayer: 0, upperReferenceLayer: 0, lowerReferenceLayer: 0, gapMil: 0, layerWidths: {} });
				groups.get(name).nets.push(item.net); item.widthMil = width; item.profileName = name;
				continue;
			}
			const key = `${item.category === 'differential' ? 'd' : 's'}_${item.targetOhms}`;
			const rows = resultsByTarget.get(key) || [];
			if (!rows.length) continue;
			const firstRow = rows[0], width = firstRow.width, gap = firstRow.gap || 6;
			const name = item.category === 'differential'
				? `ADR_DIFF${firstRow.target ?? item.targetOhms}_${profileNumber(width)}MIL_${profileNumber(gap)}GAP`
				: `ADR_Z${firstRow.target ?? item.targetOhms}_${profileNumber(width)}MIL`;
			if (!groups.has(name)) {
				const layerWidths = {};
				for (const row of rows) layerWidths[row.layer] = row.width;
				groups.set(name, { profileName: name, category: item.category, nets: [], widthMil: width, targetOhms: firstRow.target ?? item.targetOhms, impedanceLayer: firstRow.layer, upperReferenceLayer: firstRow.upperRef, lowerReferenceLayer: firstRow.lowerRef, gapMil: gap, layerWidths });
			}
			groups.get(name).nets.push(item.net); item.widthMil = width; item.profileName = name;
			if (item.polarity === 'positive' && !pairs.some(p => p.positiveNet === item.net)) pairs.push({ name: `ADR_${item.pairName}`, positiveNet: item.net, negativeNet: item.mate });
		}
		const power = [...groups.values()].find(rule => rule.category === 'power');
		// One net class per generated impedance rule group, mirroring PWR_Class:
		// the class name derives from the generated profile name so any target
		// impedance / geometry combination gets its own class automatically.
		const ruleGroups = [...groups.values()];
		const paletteOffset = colorSeed(ruleGroups.map(rule => rule.profileName).join('|')) % highContrastColors.length;
		ruleGroups.forEach((rule, index) => { rule.color = ruleColor(index, paletteOffset); });
		const impedanceClasses = ruleGroups
			.filter(rule => rule.category === 'differential' || rule.category === 'impedance')
			.map(rule => ({
				name: `${rule.profileName}_CLASS`,
				color: rule.color,
				profileName: rule.profileName,
				nets: rule.nets,
			}));
		const solveViaDiameter = (current, tempRise, copperUm) => {
			const c = Math.pow(current / (0.02 * Math.pow(tempRise, 0.44)), 1 / 0.725);
			return (c * 25.4 * 25.4) / (3140 * copperUm);
		};
		const viaProfiles = [];
		if (power) {
			const current = number('pwrCurrent') || 2;
			const tempRise = Math.max(1, number('pwrTempRise') || 20);
			const copperUm = Math.max(1, Number($('#pwrCopperOz')?.value) || 35);
			const innerDiameter = Math.max(0.2, solveViaDiameter(current, tempRise, copperUm));
			viaProfiles.push({ profileName: 'PWR', className: 'PWR_Class', ruleProfileName: 'PWR', nets: power.nets, outerDiameter: Math.max(innerDiameter + 0.3, innerDiameter * 1.75), innerDiameter });
		}
		state.plan = { rules: ruleGroups, differentialPairs: pairs, powerClass: power ? { name: 'PWR_Class', color: power.color, nets: power.nets } : null, impedanceClasses, viaProfiles, colorEnabled: $('#autoRuleColors').checked, warnings: state.classified.flatMap(item => item.warnings.map(warning => `${item.net}: ${warning}`)) };
		render();
	}
	async function scan() { if (!api) throw new Error('IFrame 未获得 EasyEDA API，请从扩展菜单打开'); status('正在读取 PCB', '读取网络与现有设计规则'); setProgress('正在读取 PCB', 10); const [configuration, netRules, pairs, netClasses, nets] = await Promise.all([api.pcb_Drc.getCurrentRuleConfiguration(), api.pcb_Drc.getNetRules(), api.pcb_Drc.getAllDifferentialPairs(), api.pcb_Drc.getAllNetClasses(), api.pcb_Net.getAllNetsName()]); setProgress('正在识别网络', 45); state.netClasses = netClasses; state.snapshot = { configuration, netRules, differentialPairs: pairs, netClasses, nets, timestamp: new Date().toISOString() }; state.classified = classify(nets); state.aiInputs = []; if ($('#aiEnabled').checked) { setProgress('AI 正在识别网络', 60); try { const ai = await aiClassify(nets, { layers: number('layers'), thickness: number('thickness') }); state.classified = state.classified.map(item => { const aiItem = ai.map[item.net]; if (!aiItem) return item; return { ...item, ...aiItem, net: item.net, pairName: item.pairName || (aiItem.category === 'differential' ? `${item.net.slice(0, -2)}_D` : undefined), warnings: [] }; }); state.aiInputs = ai.inputs; toast('AI 识别完成'); } catch (error) { toast(`AI 识别失败，使用内置规则：${error.message}`, true); } } state.plan = null; state.selected = null; state.evaluations = []; render(); renderImpedanceInputs(); $('#planMeta').textContent = '计算后选择方案'; $('#planCards').innerHTML = '<p class="empty small">填写阻抗输入后点击“计算设计规则”</p>'; $('#calculateBtn').disabled = false; $('#applyBtn').disabled = true; status('扫描完成', `${nets.length} 个网络 · 请填写阻抗输入后计算`); setProgress('扫描完成', 100); }
	function pcbLayerIdForSeq(layer) {
		const total = Math.max(2, number('layers'));
		const seq = Number(layer);
		if (!Number.isFinite(seq) || seq < 1) return 1;
		if (seq <= 1) return 1;
		if (seq >= total) return 2;
		return 14 + (seq - 1);
	}
	function allLayerData(targetLayer, targetValue, defaultValue, layerWidths) {
		const total = Math.max(2, number('layers')), data = {};
		const min = Number.isFinite(Number(targetValue)) ? Number(targetValue) : 0;
		const fallback = Number.isFinite(Number(defaultValue)) ? Number(defaultValue) : min;
		for (let seq = 1; seq <= total; seq++) {
			const lid = pcbLayerIdForSeq(seq);
			const layerValue = layerWidths && Number(layerWidths[seq]);
			const dv = Number.isFinite(layerValue) ? layerValue : fallback;
			const normalizedMin = Math.min(min, dv);
			data[lid] = { minValue: normalizedMin, defaultValue: dv, maxValue: Math.max(100, dv) };
		}
		return data;
	}
	function profile(type, name, width, gap, template, layer, layerWidths) {
		const unit = 'mil';
		const seq = Number(layer);
		const targetLayer = Number.isFinite(seq) && seq >= 1 ? seq : 1;
		const result = structuredClone(template || (type === 'differential' ? { editName: name, unit: 'mil', isSetDefault: false, form: { strokeWidthTables: { status: 1, data: allLayerData(targetLayer, width, width, layerWidths) }, diffPairSpacingTables: { status: 1, data: allLayerData(targetLayer, gap, gap, null) }, differentailPairLenTolerMax: 10 } } : { editName: name, unit: 'mil', isSetDefault: false, form: { status: 1, data: allLayerData(targetLayer, width, width, layerWidths) } }));
		result.unit = 'mil';
		if (type === 'differential') {
			result.editName = name; result.isSetDefault = false;
			result.form.strokeWidthTables.data = allLayerData(targetLayer, width, width, layerWidths);
			result.form.diffPairSpacingTables.data = allLayerData(targetLayer, gap, Number.isFinite(Number(gap)) ? Number(gap) : 5, null);
			result.form.differentailPairLenTolerMax = 10;
			return result;
		}
		result.editName = name; result.isSetDefault = false; result.form = result.form || { status: 1, data: {} }; result.form.data = allLayerData(targetLayer, width, width, layerWidths);
		return result;
	}
	function selectedLayerRoles() { return [...document.querySelectorAll('.layer-role-select')].reduce((map, item) => { map[Number(item.dataset.layer)] = item.value; return map; }, {}); }
	function selectedReferenceMode() { return $('#referenceMode')?.value || 'custom'; }
	function firstSignalLayer() { const roles = selectedLayerRoles(); for (let layer = 1; layer <= number('layers'); layer++) if (roles[layer] === 'signal') return layer; return 1; }
	function findNearestRoleLayer(start, direction, role) { const roles = selectedLayerRoles(); for (let layer = start + direction; layer >= 1 && layer <= number('layers'); layer += direction) if (roles[layer] === role) return layer; return 0; }
	function findNearestNonSignalLayer(start, direction) { const roles = selectedLayerRoles(); for (let layer = start + direction; layer >= 1 && layer <= number('layers'); layer += direction) if (roles[layer] && roles[layer] !== 'signal') return layer; return 0; }
	function inferReferences(layer) { const mode = selectedReferenceMode(); if (mode === 'adjacent') return { upper: findNearestNonSignalLayer(layer, -1), lower: findNearestNonSignalLayer(layer, 1) }; if (mode === 'ground') return { upper: findNearestRoleLayer(layer, -1, 'ground'), lower: findNearestRoleLayer(layer, 1, 'ground') }; return { upper: 0, lower: 0 }; }
	function autoImpedanceLayer() { const mode = selectedReferenceMode(), roles = selectedLayerRoles(); const candidates = []; for (let layer = 1; layer <= number('layers'); layer++) { if (roles[layer] !== 'signal') continue; const refs = inferReferences(layer); const upperRole = roles[refs.upper], lowerRole = roles[refs.lower]; const refCount = Number(!!refs.upper) + Number(!!refs.lower); if (!refCount) continue; const groundHits = Number(upperRole === 'ground') + Number(lowerRole === 'ground'); const nonSignalHits = Number(upperRole && upperRole !== 'signal') + Number(lowerRole && lowerRole !== 'signal'); const distanceScore = (refs.upper ? Math.abs(layer - refs.upper) : 0) + (refs.lower ? Math.abs(refs.lower - layer) : 0); const score = mode === 'ground' ? groundHits * 100 + nonSignalHits * 10 + refCount * 3 - distanceScore : refCount * 100 - distanceScore; candidates.push({ layer, refs, score }); } return (candidates.sort((a, b) => b.score - a.score || a.layer - b.layer)[0] || { layer: firstSignalLayer(), refs: inferReferences(firstSignalLayer()) }).layer; }
	function layerData(value, unit = 'mil', layer = 1, role = 'signal') { const converted = unit === 'mm' ? value * 0.0254 : value, max = unit === 'mm' ? 2.54 : 100, data = {}; for (let seq = 1; seq <= Math.max(2, number('layers')); seq++) { const layerId = pcbLayerIdForSeq(seq); data[layerId] = { minValue: converted, defaultValue: converted, maxValue: max, layerRole: role }; } return data; }
	function spacingProfile(name, clearance, template) { const copy = structuredClone(template), row = copy.row.indexOf('Track'), column = copy.column.indexOf('Track'); copy.editName = name; copy.isSetDefault = false; if (row < 0 || column < 0) throw new Error('安全间距模板缺少 Track 行列'); for (const table of Object.values(copy.tables || {})) table.content[row][column] = clearance; return copy; }
	function viaSizeProfile(name, outer, inner, template) {
		const copy = structuredClone(template || {});
		copy.editName = name;
		copy.unit = 'mm';
		copy.isSetDefault = false;
		copy.form = copy.form || {};
		copy.form.viaOuterdiameterDefault = outer;
		copy.form.viaInnerdiameterDefault = inner;
		copy.form.viaOuterdiameterMin = Number.isFinite(copy.form.viaOuterdiameterMin) ? Math.min(copy.form.viaOuterdiameterMin, outer) : outer;
		copy.form.viaOuterdiameterMax = Number.isFinite(copy.form.viaOuterdiameterMax) ? Math.max(copy.form.viaOuterdiameterMax, outer) : outer;
		copy.form.viaInnerdiameterMin = Number.isFinite(copy.form.viaInnerdiameterMin) ? Math.min(copy.form.viaInnerdiameterMin, inner) : inner;
		copy.form.viaInnerdiameterMax = Number.isFinite(copy.form.viaInnerdiameterMax) ? Math.max(copy.form.viaInnerdiameterMax, inner) : inner;
		return copy;
	}
	async function apply() {
		if (!state.snapshot || !state.plan) return;
		if (!state.selected?.verified) throw new Error('未验证的阻抗估算仅供预览，不能生成设计规则');
		if (state.calculationSignature !== calculationSignature()) throw new Error('计算参数已变化，请重新计算后生成');
		$('#applyBtn').disabled = true;
		status('正在生成', '读取当前规则作为新配置模板'); setProgress('正在准备新配置', 15);
		const [freshConfig, projectInfo, boardInfo] = await Promise.all([
			api.pcb_Drc.getCurrentRuleConfiguration(),
			api.dmt_Project.getCurrentProjectInfo(),
			api.dmt_Board.getCurrentBoardInfo(),
		]);
		if (!projectInfo || !boardInfo) throw new Error('无法读取当前工程或板子名称，设计规则未生成');
		const configurationName = projectBoardConfigurationName(projectInfo, boardInfo);
		adrLog('apply.start', { planRules: state.plan.rules.length, planNets: state.plan.rules.reduce((n, rule) => n + rule.nets.length, 0), configKeys: Object.keys(freshConfig || {}), spacingKeys: Object.keys(freshConfig?.config?.Spacing || {}), trackKeys: Object.keys(freshConfig?.config?.Physics?.Track || {}), diffKeys: Object.keys(freshConfig?.config?.Physics?.['Differential Pair'] || {}) });
		const cfg = structuredClone(freshConfig);
		if (!cfg?.config?.Spacing?.['Safe Spacing'] || !cfg?.config?.Physics?.Track || !cfg?.config?.Physics?.['Differential Pair']) throw new Error('规则配置结构不完整，拒绝写入');
		for (const section of Object.values(cfg.config.Spacing)) if (!section || typeof section !== 'object') throw new Error('规则配置的 Spacing 结构无效');
		const spacing = cfg.config.Spacing['Safe Spacing'];
		const tracks = cfg.config.Physics.Track;
		const diffs = cfg.config.Physics['Differential Pair'];
		const viaSizes = cfg.config.Physics['Via Size'];
		if (!viaSizes) throw new Error('规则配置缺少 Via Size，拒绝写入');
		const nativeTrackKeys = Object.keys(tracks).filter(key => key.startsWith('copperThickness'));
		for (const key of Object.keys(tracks)) if (!nativeTrackKeys.includes(key)) delete tracks[key];
		const nativeDiffKeys = Object.keys(diffs).filter(key => key === 'differentialPair');
		for (const key of Object.keys(diffs)) if (!nativeDiffKeys.includes(key)) delete diffs[key];
		adrLog('config.cleaned', { nativeTrackKeys, nativeDiffKeys, removedTrackCount: Object.keys(freshConfig?.config?.Physics?.Track || {}).length - nativeTrackKeys.length, removedDiffCount: Object.keys(freshConfig?.config?.Physics?.['Differential Pair'] || {}).length - nativeDiffKeys.length });
		const trackTemplate = Object.values(tracks).find(item => item.isSetDefault) || Object.values(tracks)[0];
		const diffTemplate = diffs.differentialPair || Object.values(diffs).find(item => item.isSetDefault) || Object.values(diffs)[0];
		const safeSpacingTemplate = spacing.copperThickness1oz || Object.values(spacing)[0];
		const viaTemplate = Object.values(viaSizes).find(item => item.isSetDefault) || Object.values(viaSizes)[0];
		const powerVia = state.plan.viaProfiles?.find(item => item.className === 'PWR_Class');
		if (powerVia) viaSizes.PWR = viaSizeProfile('PWR', powerVia.outerDiameter, powerVia.innerDiameter, viaTemplate);
		for (const rule of state.plan.rules) {
			adrLog('profile', { name: rule.profileName, category: rule.category, widthMil: rule.widthMil, gapMil: rule.gapMil, layerWidths: rule.layerWidths, impedanceLayer: rule.impedanceLayer });
			if (rule.category === 'differential') {
				diffs[rule.profileName] = profile('differential', rule.profileName, rule.widthMil, rule.gapMil, diffTemplate, rule.impedanceLayer, rule.layerWidths);
				if (!safeSpacingTemplate) throw new Error('缺少 Safe Spacing 原生模板');
				spacing[rule.profileName] = structuredClone(safeSpacingTemplate);
				spacing[rule.profileName].editName = rule.profileName;
				spacing[rule.profileName].isSetDefault = false;
			} else tracks[rule.profileName] = profile(rule.category, rule.profileName, rule.widthMil, undefined, rule.category === 'power' ? trackTemplate : undefined, rule.impedanceLayer, rule.layerWidths);
		}
		const rules = structuredClone(state.snapshot.netRules);
		for (const row of rules) {
			const item = state.plan.rules.find(rule => rule.nets.includes(row.name));
			if (!item) continue;
			row['Safe Spacing'] = item.profileName;
			if (item.category === 'differential') { row['Differential Pair'] = item.profileName; row.Track = 'default'; }
			else row.Track = item.profileName;
		}
		try {
			// Save a complete named configuration without activating it.
			const serializedConfig = JSON.stringify(cfg.config);
			const diffShapes = Object.fromEntries(Object.entries(cfg.config.Physics?.['Differential Pair'] || {}).map(([key, value]) => [key, { editName: value?.editName, unit: value?.unit, isSetDefault: value?.isSetDefault, formKeys: Object.keys(value?.form || {}), widthData: value?.form?.strokeWidthTables?.data, spacingData: value?.form?.diffPairSpacingTables?.data, tolerance: value?.form?.differentailPairLenTolerMax }]));
			adrLog('config.ready', { bytes: serializedConfig?.length, hasNaN: serializedConfig?.includes('NaN'), hasUndefined: serializedConfig?.includes('undefined'), spacingKeys: Object.keys(cfg.config.Spacing || {}), trackKeys: Object.keys(cfg.config.Physics?.Track || {}), diffKeys: Object.keys(cfg.config.Physics?.['Differential Pair'] || {}), trackShapes: Object.fromEntries(Object.entries(cfg.config.Physics?.Track || {}).map(([key, value]) => [key, { editName: value?.editName, unit: value?.unit, isSetDefault: value?.isSetDefault, formKeys: Object.keys(value?.form || {}), data: value?.form?.data }])), diffShapes });
			adrLog('config.diffJson', JSON.stringify(diffShapes));
			if (!serializedConfig || serializedConfig.includes('NaN') || serializedConfig.includes('undefined')) throw new Error('设计规则配置包含无效值');
			if (typeof api.pcb_Drc.saveRuleConfiguration !== 'function') throw new Error('当前 EasyEDA 不支持保存设计规则配置 API');
			adrLog('save.begin', { configurationName, method: 'api.pcb_Drc.saveRuleConfiguration' });
			const saved = await api.pcb_Drc.saveRuleConfiguration(cfg.config, configurationName, true);
			adrLog('save.result', { configurationName, saved });
			if (!saved) throw new Error(`设计规则 ${configurationName} 保存失败`);
			const savedConfiguration = await api.pcb_Drc.getRuleConfiguration(configurationName);
			adrLog('save.readback', { configurationName, hasConfig: !!savedConfiguration?.config, spacingKeys: Object.keys(savedConfiguration?.config?.Spacing || {}), trackKeys: Object.keys(savedConfiguration?.config?.Physics?.Track || {}), diffKeys: Object.keys(savedConfiguration?.config?.Physics?.['Differential Pair'] || {}) });
			if (!savedConfiguration?.config?.Spacing?.['Safe Spacing']) throw new Error(`设计规则 ${configurationName} 回读失败`);
			// A generated configuration is deliberately not activated here. Activating it, or
			// writing pairs/classes/net rules afterwards, would mutate the rules currently in use.
			status('生成成功', `已生成 ${configurationName}；当前使用的设计规则未更改`);
			setProgress('生成完成', 100);
			toast(`设计规则已生成：${configurationName}`);
			return;
			// Saving a named configuration does not activate it. Activate the complete config so
			// the PWR Track profile is resolvable by the active net-class rule.
			adrLog('activate.begin', { configurationName });
			const activated = await api.pcb_Drc.overwriteCurrentRuleConfiguration(savedConfiguration.config);
			adrLog('activate.result', { configurationName, activated });
			if (activated === false) throw new Error('设计规则配置激活失败');
			const activeConfiguration = await api.pcb_Drc.getCurrentRuleConfiguration();
			if (!activeConfiguration?.config?.Physics?.Track?.PWR) throw new Error('PWR 导线规则未激活');
			if (powerVia && !activeConfiguration?.config?.Physics?.['Via Size']?.PWR) throw new Error('PWR 过孔尺寸规则未激活');
			status('配置已保存', `已保存为 ${configurationName} 并已激活，继续写入网络类和网络规则`); setProgress('正在写入网络规则', 55);
			toast(`规则配置已保存：${configurationName}`);
			// Differential-pair net rules reference pair objects, so create the pairs first.
			for (const pair of state.snapshot.differentialPairs.filter(item => item.name.startsWith('ADR_'))) await api.pcb_Drc.deleteDifferentialPair(pair.name);
			const currentPairsAfterDelete = await api.pcb_Drc.getAllDifferentialPairs();
			const currentPairItems = Array.isArray(currentPairsAfterDelete) ? currentPairsAfterDelete : Object.values(currentPairsAfterDelete || {});
			for (const pair of state.plan.differentialPairs) {
				const existing = currentPairItems.find(item => item.positiveNet === pair.positiveNet && item.negativeNet === pair.negativeNet);
				if (!existing && !await api.pcb_Drc.createDifferentialPair(pair.name, pair.positiveNet, pair.negativeNet)) throw new Error(`差分对 ${pair.name} 创建失败`);
				if (existing && existing.name !== pair.name && !await api.pcb_Drc.modifyDifferentialPairName(existing.name, pair.name)) throw new Error(`差分对 ${pair.name} 重命名失败`);
			}
			const createdPairs = await api.pcb_Drc.getAllDifferentialPairs();
			const createdPairItems = Array.isArray(createdPairs) ? createdPairs : Object.values(createdPairs || {});
			const createdPairNames = new Set(createdPairItems.map(item => item.name));
			adrLog('differentialPairs.ready', { expected: state.plan.differentialPairs.map(pair => pair.name), actual: [...createdPairNames] });
			for (const pair of state.plan.differentialPairs) if (!createdPairNames.has(pair.name)) throw new Error(`差分对 ${pair.name} 回读失败`);
			// Write ordinary net rules after pair objects exist; the Differential Pair field can now resolve.

			const mergedRules = rules.filter(row => row.type !== 'netClass');
			for (const row of mergedRules) {
				const item = state.plan.rules.find(rule => rule.nets.includes(row.name));
				if (row.type === 'netClass') continue;
				if (!item) { row['Safe Spacing'] = 'default'; continue; }
				if (item.category === 'differential') {
					// overwriteNetRules() force-normalizes the Differential Pair field to "default"
					// (verified live: even the native "differentialPair" key is rejected), so only
					// the Safe Spacing profile carrying the same name can be bound here.
					// DIFFER_ENTAIL binding is patched into the document source later.
					row['Safe Spacing'] = item.profileName;
					delete row['Differential Pair'];
					row.Track = 'default';
				} else {
					row['Safe Spacing'] = 'default';
					row.Track = item.profileName;
				}
			}
			if (!await api.pcb_Drc.overwriteNetRules(mergedRules)) throw new Error('网络规则写入失败');
			// Bind each created differential pair to its generated Differential Pair profile on both nets.
			const pairRules = await api.pcb_Drc.getNetRules();
			for (const pair of state.plan.differentialPairs) {
				const rule = state.plan.rules.find(item => item.category === 'differential' && item.nets.includes(pair.positiveNet)) || state.plan.rules.find(item => item.category === 'differential' && item.nets.includes(pair.negativeNet));
				if (!rule) throw new Error(`差分对 ${pair.name} 没有匹配的差分规则`);
				for (const netName of [pair.positiveNet, pair.negativeNet]) {
					const row = pairRules.find(item => item.type === 'net' && item.name === netName);
					if (!row) throw new Error(`差分对 ${pair.name} 的网络规则不存在：${netName}`);
					row['Safe Spacing'] = rule.profileName;
					delete row['Differential Pair'];
				}
			}
			adrLog('differentialRules.bind', { bindings: state.plan.differentialPairs.map(pair => ({ pair: pair.name, rule: (state.plan.rules.find(item => item.category === 'differential' && (item.nets.includes(pair.positiveNet) || item.nets.includes(pair.negativeNet))) || {}).profileName, nets: [pair.positiveNet, pair.negativeNet] })) });
			if (!await api.pcb_Drc.overwriteNetRules(pairRules)) throw new Error('差分对规则绑定失败');
			// overwriteNetRules() cannot set the Differential Pair field away from "default"
			// (the API silently drops the DIFFER_ENTAIL binding). The verified workaround is to
			// patch the RULE_SELECTOR ruleKeyValue.DIFFER_ENTAIL entry in the raw document
			// source, exactly like the EasyEDA UI does.
			const sourceBindings = [];
			for (const pair of state.plan.differentialPairs) {
				const rule = state.plan.rules.find(item => item.category === 'differential' && (item.nets.includes(pair.positiveNet) || item.nets.includes(pair.negativeNet)));
				if (!rule) throw new Error(`差分对 ${pair.name} 没有匹配的差分规则`);
				sourceBindings.push({ profileName: rule.profileName, netNames: [pair.positiveNet, pair.negativeNet] });
			}
			const documentSource = await api.sys_FileManager.getDocumentSource();
			if (typeof documentSource !== 'string' || !documentSource) throw new Error('无法读取 PCB 文档源码，差分规则未写入');
			const patchedBindings = patchDifferentialRuleBindings(documentSource, sourceBindings);
			if (patchedBindings.missing.length) throw new Error(`差分规则未找到对应 RULE_SELECTOR：${patchedBindings.missing.join(', ')}`);
			adrLog('differentialRules.docSource', { changes: patchedBindings.changes, matched: patchedBindings.matched });
			if (patchedBindings.changes.length && !await api.sys_FileManager.setDocumentSource(patchedBindings.text)) throw new Error('差分规则文档源码写入失败');
			const boundRules = await api.pcb_Drc.getNetRules();
			for (const pair of state.plan.differentialPairs) {
				const rule = state.plan.rules.find(item => item.category === 'differential' && (item.nets.includes(pair.positiveNet) || item.nets.includes(pair.negativeNet)));
				for (const netName of [pair.positiveNet, pair.negativeNet]) {
					// Nets inside a class no longer have their own top-level row; check the class sub row too.
					const row = boundRules.find(item => item.type === 'net' && item.name === netName)
						|| boundRules.flatMap(item => item.type === 'netClass' ? item.sub || [] : []).find(sub => sub.name === netName);
					if (row?.['Differential Pair'] !== rule?.profileName || row?.['Safe Spacing'] !== rule?.profileName) throw new Error(`差分对 ${pair.name} 的规则绑定回读失败：${netName}`);
				}
			}
			// Create impedance net classes dynamically from the generated plan and bind
			// their generated Safe Spacing profile on each class row.
			const normalizeClassName = name => String(name || '').replace(/[ _-]/g, '').toLowerCase();
			for (const impedanceClass of (state.plan.impedanceClasses || [])) {
				const classes = await api.pcb_Drc.getAllNetClasses();
				const existing = classes.find(item => normalizeClassName(item.name) === normalizeClassName(impedanceClass.name));
				if (!existing && !await api.pcb_Drc.createNetClass(impedanceClass.name, impedanceClass.nets, impedanceClass.color)) throw new Error(`网络类 ${impedanceClass.name} 创建失败`);
				if (existing) {
					const missingNets = impedanceClass.nets.filter(net => !(existing.nets || []).includes(net));
					if (missingNets.length && !await api.pcb_Drc.addNetToNetClass(existing.name, missingNets)) throw new Error(`网络类 ${existing.name} 添加网络失败：${missingNets.join(', ')}`);
				}
				let bound = false;
				for (let attempt = 0; attempt < 5 && !bound; attempt++) {
					if (attempt) await new Promise(resolve => setTimeout(resolve, 200));
					const classRules = await api.pcb_Drc.getNetRules();
					const classRule = classRules.find(row => row.type === 'netClass' && normalizeClassName(row.name) === normalizeClassName(impedanceClass.name));
					if (!classRule) continue;
					classRule['Safe Spacing'] = impedanceClass.profileName;
					for (const sub of classRule.sub || []) if (impedanceClass.nets.includes(sub.name)) sub['Safe Spacing'] = impedanceClass.profileName;
					if (await api.pcb_Drc.overwriteNetRules(classRules) === false) throw new Error(`网络类 ${impedanceClass.name} 规则写入失败`);
					const verified = await api.pcb_Drc.getNetRules();
					const verifiedClass = verified.find(row => row.type === 'netClass' && normalizeClassName(row.name) === normalizeClassName(impedanceClass.name));
					bound = verifiedClass?.['Safe Spacing'] === impedanceClass.profileName
						&& impedanceClass.nets.every(net => (verifiedClass.sub || []).some(sub => sub.name === net && sub['Safe Spacing'] === impedanceClass.profileName));
				}
				if (!bound) throw new Error(`网络类 ${impedanceClass.name} 的 Safe Spacing 规则回读失败`);
				adrLog('impedanceClass.bound', { name: impedanceClass.name, profile: impedanceClass.profileName, nets: impedanceClass.nets });
			}
			if (state.plan.powerClass) {
				const classes = await api.pcb_Drc.getAllNetClasses();
				const existing = classes.find(item => normalizeClassName(item.name) === normalizeClassName(state.plan.powerClass.name));
				if (!existing && !await api.pcb_Drc.createNetClass(state.plan.powerClass.name, state.plan.powerClass.nets, state.plan.powerClass.color)) throw new Error(`网络类 ${state.plan.powerClass.name} 创建失败`);
				for (let attempt = 0; attempt < 5; attempt++) {
					if (attempt) await new Promise(resolve => setTimeout(resolve, 200));
					const classRules = await api.pcb_Drc.getNetRules();
					const classRule = classRules.find(row => row.type === 'netClass' && normalizeClassName(row.name) === normalizeClassName(state.plan.powerClass.name));
					if (!classRule) continue;
					classRule.Track = 'PWR';
					classRule['Via Size'] = 'PWR';
					for (const sub of classRule.sub || []) if (state.plan.powerClass.nets.includes(sub.name)) { sub.Track = 'PWR'; sub['Via Size'] = 'PWR'; }
					if (await api.pcb_Drc.overwriteNetRules(classRules) === false) throw new Error('网络类规则写入失败');
					const verified = await api.pcb_Drc.getNetRules();
					const verifiedClass = verified.find(row => row.type === 'netClass' && normalizeClassName(row.name) === normalizeClassName(state.plan.powerClass.name));
					if (verifiedClass?.Track === 'PWR' && verifiedClass?.['Via Size'] === 'PWR' && (verifiedClass.sub || []).filter(sub => state.plan.powerClass.nets.includes(sub.name)).every(sub => sub.Track === 'PWR' && sub['Via Size'] === 'PWR')) break;
				}
			}
			const expectedNames = [...new Set(state.plan.rules.flatMap(item => item.nets).filter(net => !state.plan.powerClass?.nets.includes(net) && !state.plan.impedanceClasses?.some(cls => cls.nets.includes(net)) && !state.plan.viaProfiles?.some(cls => cls.nets.includes(net))))];
			// Create the class after ordinary rules, then assign its materialized rule to PWR.
			if (state.plan.powerClass) {
				await applyPowerClass(state.plan.powerClass);
				for (let attempt = 0; attempt < 5; attempt++) {
					if (attempt) await new Promise(resolve => setTimeout(resolve, 200));
					const classRules = await api.pcb_Drc.getNetRules();
					const normalizeClassName = name => String(name || '').replace(/[ _-]/g, '').toLowerCase();
					const classRule = classRules.find(row => row.type === 'netClass' && normalizeClassName(row.name) === normalizeClassName(state.plan.powerClass.name));
					if (!classRule) continue; // class rule may materialize asynchronously
					classRule.Track = 'PWR';
					for (const sub of classRule.sub || []) if (state.plan.powerClass.nets.includes(sub.name)) sub.Track = 'PWR';
					if (await api.pcb_Drc.overwriteNetRules(classRules) === false) throw new Error('网络类规则写入失败');
					// Verify by resolved profile value, not by UI display of the profile name.
					const verified = await api.pcb_Drc.getNetRules();
					const verifiedClass = verified.find(row => row.type === 'netClass' && normalizeClassName(row.name) === normalizeClassName(state.plan.powerClass.name));
					if (verifiedClass?.Track === 'PWR' && (verifiedClass.sub || []).filter(sub => state.plan.powerClass.nets.includes(sub.name)).every(sub => sub.Track === 'PWR')) break;
				}
			}
			let readback = [];
			let missingNames = expectedNames;
			for (let attempt = 0; attempt < 5 && missingNames.length; attempt++) {
				if (attempt) await new Promise(resolve => setTimeout(resolve, 150));
				readback = await api.pcb_Drc.getNetRules();
				const actualNames = new Set(readback.map(item => item.name).filter(name => typeof name === 'string'));
				missingNames = expectedNames.filter(name => !actualNames.has(name));
			}
			if (missingNames.length) {
				const recovered = [...readback, ...rules.filter(row => missingNames.includes(row.name))];
				if (!await api.pcb_Drc.overwriteNetRules(recovered)) throw new Error('网络规则补写失败');
				readback = await api.pcb_Drc.getNetRules();
				const actualNames = new Set(readback.map(item => item.name).filter(name => typeof name === 'string'));
				missingNames = expectedNames.filter(name => !actualNames.has(name));
			}
			if (missingNames.length) throw new Error(`网络规则回读缺少 ${missingNames.length} 个网络：${missingNames.slice(0, 5).join(', ')}`);
			if (state.plan.powerClass) {
				const classes = await api.pcb_Drc.getAllNetClasses();
				const normalizeClassName = name => String(name || '').replace(/[ _-]/g, '').toLowerCase();
				const verifyClass = classes.find(item => normalizeClassName(item.name) === normalizeClassName(state.plan.powerClass.name));
				const finalRules = await api.pcb_Drc.getNetRules();
				const finalClass = finalRules.find(row => row.type === 'netClass' && normalizeClassName(row.name) === normalizeClassName(state.plan.powerClass.name));
				if (!verifyClass) throw new Error(`网络类 ${state.plan.powerClass.name} 未生成`);
				const missingClassNets = state.plan.powerClass.nets.filter(net => !(verifyClass.nets || []).includes(net));
				if (missingClassNets.length) throw new Error(`网络类 ${state.plan.powerClass.name} 缺少网络：${missingClassNets.join(', ')}`);
				if (finalClass?.Track !== 'PWR' || finalClass?.['Via Size'] !== 'PWR' || !(finalClass.sub || []).filter(sub => state.plan.powerClass.nets.includes(sub.name)).every(sub => sub.Track === 'PWR' && sub['Via Size'] === 'PWR')) throw new Error(`网络类 ${state.plan.powerClass.name} 的 PWR 导线/过孔规则回读失败`);
			}
			// Final verification for every dynamically generated impedance class.
			if (state.plan.impedanceClasses?.length) {
				const classes = await api.pcb_Drc.getAllNetClasses();
				const normalizeClassName = name => String(name || '').replace(/[ _-]/g, '').toLowerCase();
				const finalRules = await api.pcb_Drc.getNetRules();
				for (const impedanceClass of state.plan.impedanceClasses) {
					const verifyClass = classes.find(item => normalizeClassName(item.name) === normalizeClassName(impedanceClass.name));
					const finalClass = finalRules.find(row => row.type === 'netClass' && normalizeClassName(row.name) === normalizeClassName(impedanceClass.name));
					if (!verifyClass) throw new Error(`网络类 ${impedanceClass.name} 未生成`);
					const missingClassNets = impedanceClass.nets.filter(net => !(verifyClass.nets || []).includes(net));
					if (missingClassNets.length) throw new Error(`网络类 ${impedanceClass.name} 缺少网络：${missingClassNets.join(', ')}`);
					if (finalClass?.['Safe Spacing'] !== impedanceClass.profileName || !(finalClass.sub || []).filter(sub => impedanceClass.nets.includes(sub.name)).every(sub => sub['Safe Spacing'] === impedanceClass.profileName)) throw new Error(`网络类 ${impedanceClass.name} 的 Safe Spacing 规则回读失败`);
				}
			}
			await applyRuleColors();
			status('应用成功', `物理-导线、网络类和网络规则回读验证通过${state.plan.colorEnabled ? '，规则线颜色已配置' : ''}`); setProgress('应用完成', 100); toast('设计规则与网络类已应用并验证');
		}
		catch (error) { adrError('apply.error', { message: error?.message, stack: error?.stack, name: error?.name }); status('应用失败', error.message); toast(error.message, true); throw error; }
		finally { $('#applyBtn').disabled = !state.plan || !state.selected?.verified; }
	}
	async function applyRuleColors() {
		if (!state.plan?.colorEnabled) return;
		if (typeof api?.pcb_Net?.setNetColor !== 'function' || typeof api?.pcb_Net?.getNetColor !== 'function') throw new Error('当前 EasyEDA 版本不支持规则线颜色配置');
		for (const rule of state.plan.rules) for (const net of rule.nets) {
			if (await api.pcb_Net.setNetColor(net, rule.color) === false) throw new Error(`网络 ${net} 颜色写入失败`);
			const actual = await api.pcb_Net.getNetColor(net);
			if (!actual || ['r', 'g', 'b'].some(key => Number(actual[key]) !== Number(rule.color[key]))) throw new Error(`网络 ${net} 颜色回读失败`);
		}
	}
	async function applyPowerClass(powerClass) {
		const normalizeClassName = name => String(name || '').replace(/[ _-]/g, '').toLowerCase();
		const findClass = classes => classes.find(item => normalizeClassName(item.name) === normalizeClassName(powerClass.name));
		const current = findClass(await api.pcb_Drc.getAllNetClasses());
		if (!current) {
			if (!await api.pcb_Drc.createNetClass(powerClass.name, powerClass.nets, powerClass.color)) throw new Error(`网络类 ${powerClass.name} 创建失败`);
			for (let attempt = 0; attempt < 5; attempt++) {
				const created = findClass(await api.pcb_Drc.getAllNetClasses());
				if (created) return;
				await new Promise(resolve => setTimeout(resolve, 200));
			}
			return;
		}
		const actualName = current.name;
		const missing = powerClass.nets.filter(net => !(current.nets || []).includes(net));
		if (missing.length && !await api.pcb_Drc.addNetToNetClass(actualName, missing)) throw new Error(`网络类 ${actualName} 添加网络失败`);
	}
	function render() { const names = { differential: '差分', impedance: '阻抗', power: '电源', ground: '地', signal: '普通' }, rows = state.classified.filter(item => state.filter === 'all' || item.category === state.filter); $('#netCount').textContent = `${state.classified.length} 个网络`; $('#netRows').innerHTML = rows.length ? rows.map(item => `<tr><td><b>${item.net}</b></td><td><span class="category ${item.category}">${names[item.category]}</span></td><td>${item.mate || (item.targetOhms ? `${item.targetOhms} Ω` : '—')}</td><td>${item.widthMil ? `${item.widthMil.toFixed(2)} mil` : '默认'}</td><td>${item.profileName || '不修改'}</td><td class="${item.warnings.length ? 'status-warn' : 'status-ok'}">${item.warnings[0] || '就绪'}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">此分类没有网络</td></tr>'; if (!state.plan) return; const nets = state.plan.rules.reduce((sum, rule) => sum + rule.nets.length, 0); $('#ruleMetric').textContent = state.plan.rules.length; $('#netMetric').textContent = nets; $('#pairMetric').textContent = state.plan.differentialPairs.length; $('#warningMetric').textContent = state.plan.warnings.length; $('#ruleCards').innerHTML = state.plan.rules.map(rule => `<div class="rule-card"><b><span class="color-swatch" style="background:${colorHex(rule.color)}"></span>${rule.profileName}</b><p>${rule.nets.length} 个网络 · ${rule.widthMil.toFixed(2)} mil${rule.gapMil ? ` · 间距 ${rule.gapMil} mil` : ''} · ${colorHex(rule.color)}</p></div>`).join('')
 	+ (state.plan.impedanceClasses || []).map(cls => `<div class="rule-card"><b>${cls.name}</b><p>${cls.nets.length} 个网络 · Safe Spacing → ${cls.profileName}</p></div>`).join(''); }
	function aiConfig() { return { enabled: $('#aiEnabled').checked, baseUrl: $('#aiBaseUrl').value.replace(/\/+$/, ''), apiKey: $('#aiApiKey').value, model: $('#aiModel').value, temperature: Number($('#aiTemperature').value) || 0.2 }; }
	async function aiClassify(nets, boardContext) {
		const cfg = aiConfig();
		if (!cfg.enabled) throw new Error('AI 配置未启用');
		if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) throw new Error('请先完整填写 AI Base URL / API Key / 模型');
		const systemPrompt = [
			'你是PCB网络分类专家。你必须严格按下面的JSON模板返回，不允许增删字段、不允许改变结构、不允许输出JSON以外的任何文字（包括markdown代码块标记）。',
			'category只能取: differential, impedance, power, ground, signal。',
			'差分网络必须填写mate/polarity/targetOhms(50-150)；impedance 单端/共面单端网络必须填写targetOhms(20-90)。',
			'每个差分组和阻抗组必须在impedanceInputs中有一行，differential与target必须和分类结果一致。',
			'gap即S1线距，distance即D1到铜距离，单位mil，最小2.5。',
			'模板：',
			'{"nets":{"<网络名>":{"category":"differential|impedance|power|ground|signal","mate":"<配对网络名或空串>","polarity":"positive|negative|空串","targetOhms":100},"<网络名2>":{"category":"signal","mate":"","polarity":"","targetOhms":0}},"impedanceInputs":[{"differential":true,"target":100,"gap":6,"distance":20},{"differential":false,"target":50,"gap":0,"distance":20}]}',
		].join('\n');
		const body = { model: cfg.model, temperature: cfg.temperature, response_format: { type: 'json_object' }, messages: [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: JSON.stringify({ task: '严格按模板分类以下全部PCB网络并推荐阻抗参数', 板层数: boardContext.layers, 板厚mm: boardContext.thickness, networks: nets }) }
		] };
		const response = await fetch(`${cfg.baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify(body) });
		if (!response.ok) throw new Error(`AI 请求失败：HTTP ${response.status}`);
		const data = await response.json(), content = data.choices?.[0]?.message?.content;
		if (!content) throw new Error('AI 返回为空');
		try { return validateAiResult(extractJson(content), nets); } catch (error) { throw new Error(`AI 返回非法 JSON：${error.message}`); }
	}
	function extractJson(content) {
		const text = String(content).trim();
		try { return JSON.parse(text); } catch { /* fall through to fenced / substring extraction */ }
		const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
		if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch { /* keep trying */ } }
		const start = text.indexOf('{'), end = text.lastIndexOf('}');
		if (start >= 0 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch { /* give up */ } }
		throw new Error('内容不是合法 JSON');
	}
	function validateAiResult(result, nets) {
		const categories = ['differential', 'impedance', 'power', 'ground', 'signal'];
		const set = new Set(nets);
		// Accept multiple shapes: nets map, classification array, or a results/groups array.
		let map = result?.nets;
		if (!map && Array.isArray(result?.classification)) {
			map = {};
			for (const item of result.classification) {
				if (item?.net) map[item.net] = { ...item, net: undefined };
			}
		}
		if (!map && Array.isArray(result?.networks)) {
			map = {};
			for (const item of result.networks) {
				if (item?.name) map[item.name] = { ...item, name: undefined };
			}
		}
		if (!map && (Array.isArray(result?.results) || Array.isArray(result?.groups))) {
			const list = result.results || result.groups;
			map = {};
			for (const item of list) {
				if (item?.net || item?.name) { const net = item.net || item.name; map[net] = { ...item, net: undefined, name: undefined }; }
			}
		}
		if (!map && typeof result === 'object') {
			// Shape: { "USB_DP": {...}, "USB_DM": {...}, ... } with impedanceInputs alongside.
			const candidate = {};
			let count = 0;
			for (const [key, value] of Object.entries(result)) {
				if (value && typeof value === 'object' && !Array.isArray(value) && value.category) { candidate[key] = value; count++; }
			}
			if (count > 0) map = candidate;
		}
		if (!map || typeof map !== 'object' || Object.keys(map).length === 0) {
			const keys = result && typeof result === 'object' ? Object.keys(result).slice(0, 5).join(',') : typeof result;
			throw new Error(`AI 返回缺少 nets/classification 结构（顶层键：${keys}）`);
		}
		for (const net of Object.keys(map)) {
			if (!set.has(net)) throw new Error(`AI 返回了不存在的网络：${net}`);
			const item = map[net];
			if (!categories.includes(item.category)) throw new Error(`网络 ${net} 类别非法：${item.category}`);
			if (item.category === 'differential' && (!set.has(item.mate) || !['positive', 'negative'].includes(item.polarity))) throw new Error(`差分网络 ${net} 缺少合法 mate/polarity`);
			if (item.category === 'impedance' && !(item.targetOhms >= 20 && item.targetOhms <= 90)) throw new Error(`网络 ${net} 单端/共面单端阻抗超出 20-90`);
			if (item.category === 'differential' && !(item.targetOhms >= 50 && item.targetOhms <= 150)) throw new Error(`网络 ${net} 差分阻抗超出 50-150`);
		}
		// Accept both grouped inputs and per-net inputs with gap_S1/distance_D1 keys,
		// plus per-net impedanceInputs embedded in each network item.
		const rawInputs = Array.isArray(result?.impedanceInputs) ? result.impedanceInputs : [];
		const embedded = Object.values(map).filter(item => item.impedanceInputs && typeof item.impedanceInputs === 'object').map(item => ({ net: Object.keys(map).find(key => map[key] === item), target: item.targetOhms, ...item.impedanceInputs }));
		const allInputs = [...rawInputs, ...embedded];
		const grouped = new Map();
		for (const row of allInputs) {
			const target = Number(row.target ?? row.targetOhms);
			const differential = row.differential ?? (row.net && map[row.net] ? map[row.net].category === 'differential' : undefined);
			if (differential === true ? !(target >= 50 && target <= 150) : !(target >= 20 && target <= 90)) continue;
			const gap = Math.max(2.5, Number(row.gap ?? row.gap_S1 ?? row.S1) || 0);
			const distance = Math.max(2.5, Number(row.distance ?? row.distance_D1 ?? row.D1) || 20);
			const key = `${differential === true ? 1 : 0}:${target}`;
			if (!grouped.has(key)) grouped.set(key, { differential: differential === true, target, gap: differential === true ? gap : 0, distance });
		}
		// Ensure every differential/impedance group from classification has an input row.
		for (const item of Object.values(map)) {
			if (item.category !== 'differential' && item.category !== 'impedance') continue;
			const key = `${item.category === 'differential' ? 1 : 0}:${Number(item.targetOhms)}`;
			if (!grouped.has(key)) grouped.set(key, { differential: item.category === 'differential', target: Number(item.targetOhms), gap: item.category === 'differential' ? 6 : 0, distance: 20 });
		}
		return { map, inputs: [...grouped.values()] };
	}
	async function loadAiConfig() { if (!api?.sys_Storage?.getExtensionUserConfig) return; try { const raw = await api.sys_Storage.getExtensionUserConfig('adr:ai-config'); if (!raw) return; const cfg = JSON.parse(raw); $('#aiEnabled').checked = !!cfg.enabled; $('#aiBaseUrl').value = cfg.baseUrl || 'https://api.openai.com/v1'; $('#aiModel').value = cfg.model || 'gpt-4o-mini'; $('#aiTemperature').value = String(cfg.temperature ?? 0.2); if (cfg.apiKey) { $('#aiApiKey').value = cfg.apiKey; $('#aiApiKey').dataset.loaded = '1'; } } catch { /* 忽略损坏配置 */ } }
	async function saveAiConfig() { if (!api?.sys_Storage?.setExtensionUserConfig) return; let apiKey = $('#aiApiKey').value; if (!apiKey && $('#aiApiKey').dataset.loaded === '1') { try { apiKey = JSON.parse(await api.sys_Storage.getExtensionUserConfig('adr:ai-config') || '{}').apiKey || ''; } catch { apiKey = ''; } $('#aiApiKey').value = apiKey; } await api.sys_Storage.setExtensionUserConfig('adr:ai-config', JSON.stringify({ enabled: $('#aiEnabled').checked, baseUrl: $('#aiBaseUrl').value.replace(/\/+$/, ''), model: $('#aiModel').value, temperature: Number($('#aiTemperature').value) || 0.2, apiKey })); }
	async function loadRuleColorConfig() { if (!api?.sys_Storage?.getExtensionUserConfig) return; const checkbox = $('#autoRuleColors'), hint = $('#ruleColorHint'); try { const raw = await api.sys_Storage.getExtensionUserConfig('adr:rule-color-config'); checkbox.checked = raw ? !!JSON.parse(raw).enabled : false; updateRuleColorHint(checkbox, hint); } catch { checkbox.checked = false; updateRuleColorHint(checkbox, hint); } }
	async function saveRuleColorConfig() { if (api?.sys_Storage?.setExtensionUserConfig) await api.sys_Storage.setExtensionUserConfig('adr:rule-color-config', JSON.stringify({ enabled: $('#autoRuleColors').checked })); }
	function updateRuleColorHint(checkbox = $('#autoRuleColors'), hint = $('#ruleColorHint')) { if (checkbox && hint) hint.innerHTML = checkbox.checked ? '已开启：信号、等长/差分和电源规则组将分配稳定的高对比度颜色。' : '已关闭：规则组默认颜色为 <code>#000000</code>，不会改写 PCB 网络颜色。'; }
	function calcPowerWidth() {
		const I = number('pwrCurrent'), lenMm = number('pwrLength'), copperUm = Number($('#pwrCopperOz').value);
		const isExt = $('#pwrLayerType').value === 'external', dT = number('pwrTempRise'), ambient = number('pwrAmbient');
		if (!(I > 0 && dT > 0 && copperUm > 0 && lenMm > 0)) { $('#pwrResult').innerHTML = '<p class="hint">请填写完整参数</p>'; return; }
		// JLC trace-current formula (https://www.jlc-fpc.com/trace-current-calculator)
		const k = isExt ? 0.048 : 0.024;
		const f = Math.pow(I / (k * Math.pow(dT, 0.44)), 1 / 0.725);
		const areaCm2 = f * 2.54 * 2.54 / 1e6;
		const m = 1e-4 * copperUm;
		const v = (lenMm / 1000) / 0.01; // mm→m→cm (JLC uses meters)
		const widthMm = areaCm2 / m / 0.1;
		const widthMil = widthMm / 0.0254;
		// JLC via-current inverse formula (https://www.jlc-fpc.com/via-current-calculator)
		const viaCrossSection = Math.pow(I / (0.02 * Math.pow(dT, 0.44)), 1 / 0.725);
		const viaHoleMm = Math.max(0.2, (viaCrossSection * 25.4 * 25.4) / (3140 * copperUm));
		const viaPadMm = Math.max(viaHoleMm + 0.3, viaHoleMm * 1.75);
		const viaHoleMil = viaHoleMm / 0.0254;
		const viaPadMil = viaPadMm / 0.0254;
		const opTemp = ambient + dT;
		const resistance = 17e-7 * v / areaCm2 * (1 + 0.0039 * (opTemp - 25));
		const vDrop = resistance * I, power = resistance * I * I;
		$('#pwrResult').innerHTML = `<div class="pwr-result-grid"><div><strong>${widthMil.toFixed(1)}</strong><span>线宽 / mil</span></div><div><strong>${widthMm.toFixed(3)}</strong><span>线宽 / mm</span></div><div><strong>${viaPadMil.toFixed(1)}</strong><span>过孔焊盘 / mil</span></div><div><strong>${viaHoleMil.toFixed(1)}</strong><span>过孔钻孔 / mil</span></div><div><strong>${(resistance * 1000).toFixed(1)}</strong><span>电阻 / mΩ</span></div><div><strong>${(vDrop * 1000).toFixed(1)}</strong><span>压降 / mV</span></div><div><strong>${(power * 1000).toFixed(1)}</strong><span>功耗 / mW</span></div><div><strong>${opTemp.toFixed(0)}</strong><span>工作温度 / °C</span></div></div>`;
	}
	function closeImpedanceModal() { $('#impedanceModal').hidden = true; }
	function openImpedanceModal() {
		if (!state.snapshot) { toast('请先扫描当前 PCB', true); return; }
		const type = $('#manualDifferential'), target = $('#manualTarget'), nets = $('#manualNets');
		type.value = '0'; target.value = '50'; target.min = '20'; target.max = '90'; nets.value = '';
		$('#manualNetsHint').textContent = `当前可用网络：${state.classified.filter(item => item.category === 'signal').map(item => item.net).join(', ') || '无'}`;
		$('#impedanceModal').hidden = false; target.focus();
	}
	function saveManualImpedance() {
		const differential = $('#manualDifferential').value === '1', target = Number($('#manualTarget').value);
		const min = differential ? 50 : 20, max = differential ? 150 : 90;
		if (!Number.isFinite(target) || target < min || target > max) { toast(`目标阻抗必须在 ${min}~${max} Ω 范围内`, true); return; }
		const nets = [...new Set($('#manualNets').value.split(/[,，\s]+/).map(item => item.trim()).filter(Boolean))];
		const unknown = nets.filter(net => !state.classified.some(item => item.net === net));
		if (!nets.length || unknown.length) { toast(unknown.length ? `不存在的网络：${unknown.join(', ')}` : '至少填写一个网络', true); return; }
		for (const net of nets) { const item = state.classified.find(row => row.net === net); item.category = differential ? 'differential' : 'impedance'; item.targetOhms = target; item.warnings = []; }
		closeImpedanceModal(); render(); renderImpedanceInputs(); toast(`已新增 ${target} Ω ${differential ? '差分' : '单端'}规则`);
	}
	$('#addImpedanceBtn').addEventListener('click', openImpedanceModal);
	$('#closeImpedanceBtn').addEventListener('click', closeImpedanceModal);
	$('#cancelImpedanceBtn').addEventListener('click', closeImpedanceModal);
	$('#saveImpedanceBtn').addEventListener('click', saveManualImpedance);
	$('#manualDifferential').addEventListener('change', () => { const differential = $('#manualDifferential').value === '1', target = $('#manualTarget'); target.value = differential ? '100' : '50'; target.min = differential ? '50' : '20'; target.max = differential ? '150' : '90'; });
	$('#impedanceModal').addEventListener('click', event => { if (event.target === $('#impedanceModal')) closeImpedanceModal(); });
	$('#scanBtn').addEventListener('click', () => scan().catch(error => { status('扫描失败', error.message); toast(error.message, true); }));
	$('#calculateBtn').addEventListener('click', () => { try { if (!state.snapshot) throw new Error('请先扫描当前 PCB'); setProgress('正在计算叠层', 30); calcPowerWidth(); evaluateStackups(); makePlan(); state.calculationSignature = calculationSignature(); $('#applyBtn').disabled = !state.plan || !state.selected?.verified; status('计算完成', `${state.evaluations.length} 个候选方案 · 请选择后生成`); setProgress('计算完成', 100); toast('电源线宽与设计规则已计算'); } catch (error) { status('计算失败', error.message); toast(error.message, true); } });
	$('#applyBtn').addEventListener('click', () => apply().catch(error => { status('生成失败', error.message); toast(error.message, true); }));
	$('#customRules').addEventListener('change', () => { try { JSON.parse($('#customRules').value || '[]'); toast('自定义规则已保存，重新扫描生效'); } catch { toast('规则 JSON 格式错误', true); } });
	for (const id of ['aiEnabled', 'aiBaseUrl', 'aiApiKey', 'aiModel', 'aiTemperature']) $(`#${id}`).addEventListener('change', () => { saveAiConfig().catch(() => {}); });
	$('#autoRuleColors').addEventListener('change', () => { updateRuleColorHint(); saveRuleColorConfig().catch(() => {}); if (state.plan) { makePlan(); state.calculationSignature = calculationSignature(); } });
	$('#aiTestBtn').addEventListener('click', async () => { try { setProgress('正在测试 AI 连接', 30); const cfg = aiConfig(); if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) throw new Error('请先完整填写 AI Base URL / API Key / 模型'); const response = await fetch(`${cfg.baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify({ model: cfg.model, max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); setProgress('连接测试成功', 100); toast('AI 连接测试成功'); } catch (error) { setProgress('连接测试失败', 100); toast(`AI 连接失败：${error.message}`, true); } });
	loadAiConfig();
	loadRuleColorConfig();
	calcPowerWidth();
	for (const id of ['pwrCurrent', 'pwrLength', 'pwrCopperOz', 'pwrLayerType', 'pwrAmbient', 'pwrTempRise']) $(`#${id}`).addEventListener('input', calcPowerWidth);
	for (const id of ['pwrCopperOz', 'pwrLayerType']) $(`#${id}`).addEventListener('change', calcPowerWidth);
	$('#layers').addEventListener('change', () => { updateThicknessOptions(); renderStackPreview(); if (state.classified.length) renderImpedanceInputs(); if (state.evaluations.length) refresh(); });
	$('#widthGapComplement').addEventListener('change', () => { if (state.classified.length) renderImpedanceInputs(); });
	$('#referenceMode').addEventListener('change', () => { if (state.classified.length) renderImpedanceInputs(); });
	$('#stackMode').addEventListener('change', () => { renderStackPreview(); if (state.evaluations.length) refresh(); }); $('#stackTemplate').addEventListener('change', () => { renderStackPreview(); if (state.evaluations.length) refresh(); }); for (const id of ['boardType', 'thickness', 'outerOz', 'innerOz']) $(`#${id}`).addEventListener('change', () => { renderStackPreview(); if (state.evaluations.length) refresh(); });
	renderStackPreview();
	document.querySelectorAll('.chip').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('.chip').forEach(item => item.classList.remove('active')); button.classList.add('active'); state.filter = button.dataset.filter; render(); }));
})();
