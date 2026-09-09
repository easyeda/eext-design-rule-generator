import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

function openWorkbench(nets=['CLK_Z50']) {
	const dom=new JSDOM(fs.readFileSync('iframe/index.html','utf8'),{url:'https://offline.invalid',runScripts:'outside-only'});
	const win=dom.window as any;
	const network=vi.fn(()=>{throw new Error('Network disabled in offline test');});
	win.fetch=network; win.WebSocket=network; win.XMLHttpRequest=network; win.navigator.sendBeacon=network; win.structuredClone=structuredClone;
	const savedConfig=new Map<string,string>();const netColors=new Map<string,any>();const setNetColor=vi.fn(async(net:string,color:any)=>{netColors.set(net,structuredClone(color));return true;});
	win.eda={sys_Storage:{getExtensionUserConfig:async(key:string)=>savedConfig.get(key)??null,setExtensionUserConfig:async(key:string,value:string)=>{savedConfig.set(key,value);return true;}},pcb_Drc:{
		getCurrentRuleConfiguration:async()=>({config:{}}),getNetRules:async()=>({}),
		getAllDifferentialPairs:async()=>[],getAllNetClasses:async()=>[],
	},pcb_Net:{getAllNetsName:async()=>nets,setNetColor,getNetColor:async(net:string)=>netColors.get(net)}};
	const results:any[]=[];
	for(const file of ['stackups','jlc-models','layer-thickness','jlc-core','jlc-calibration','app']){
		if(file==='app'){
			const original=win.ADR_JLC;
			win.ADR_JLC={...original,calculateRow:(...args:any[])=>{const result=original.calculateRow(...args);results.push(result);return result;}};
		}
		vm.runInContext(fs.readFileSync(`iframe/${file}.js`,'utf8'),dom.getInternalVMContext());
	}
	const el=(id:string)=>win.document.getElementById(id);
	return {dom,win,network,el,results,setNetColor,savedConfig};
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

describe('real iframe workbench with network disabled',()=>{
	it('patches only matching NET rule-selector records and is idempotent',()=>{
		const {dom,win}=openWorkbench();
		try{
			const record=(ticket:number,type:string,name:string,payload:any)=>`${JSON.stringify({type:'RULE_SELECTOR',ticket,id:JSON.stringify(['RULE_SELECTOR',[type,name]])})}||${JSON.stringify(payload)}|`;
			const source=[
				record(1,'DIFF_PAIR','ADR_USB_D',{ruleOrder:4,ruleKeyValue:{}}),
				`${JSON.stringify({type:'PAD_NET',ticket:2,id:'pad'})}||${JSON.stringify({padNet:'USB_DP'})}|`,
				record(3,'NET','USB_DP',{ruleOrder:4,ruleKeyValue:{SAFE:'old'},nested:{value:{closing:true}}}),
				record(4,'NET','USB_DM',{ruleOrder:4,ruleKeyValue:{DIFFER_ENTAIL:'old'}}),
			].join('\n');
			const binding=[{profileName:'ADR_DIFF90_8_56MIL_5GAP',netNames:['USB_DP','USB_DM']}];
			const first=win.__ADR_TEST__.patchDifferentialRuleBindings(source,binding);
			expect(first.missing).toEqual([]);
			expect(first.changes.map((item:any)=>item.net)).toEqual(['USB_DP','USB_DM']);
			expect(first.text.match(/ADR_DIFF90_8_56MIL_5GAP/g)).toHaveLength(2);
			const second=win.__ADR_TEST__.patchDifferentialRuleBindings(first.text,binding);
			expect(second.missing).toEqual([]);
			expect(second.changes).toEqual([]);
			expect(second.matched.map((item:any)=>item.net)).toEqual(['USB_DP','USB_DM']);
			expect(second.text).toBe(first.text);
		}finally{dom.window.close();}
	});
	it('reports nets without a matching NET rule selector',()=>{
		const {dom,win}=openWorkbench();
		try{
			const source=`${JSON.stringify({type:'PAD_NET',ticket:1,id:'pad'})}||${JSON.stringify({padNet:'USB_DP'})}|`;
			const result=win.__ADR_TEST__.patchDifferentialRuleBindings(source,[{profileName:'ADR_DIFF90',netNames:['USB_DP']}]);
			expect(result.changes).toEqual([]);
			expect(result.matched).toEqual([]);
			expect(result.missing).toEqual(['USB_DP']);
			expect(result.text).toBe(source);
		}finally{dom.window.close();}
	});
	it('names a generated configuration from the project and board',()=>{
		const {dom,win}=openWorkbench();
		try{
			expect(win.__ADR_TEST__.projectBoardConfigurationName({friendlyName:'ROS-Board_ESP32S3_copy'},{name:'PCB1'})).toBe('ROS-Board_ESP32S3_copy-PCB1');
			expect(win.__ADR_TEST__.projectBoardConfigurationName({friendlyName:'Project/A'},{name:'Board:1'})).toBe('Project_A-Board_1');
			expect(win.__ADR_TEST__.projectBoardConfigurationName({},{})).toBe('未命名工程-未命名板子');
		}finally{dom.window.close();}
	});
	it('defaults to 1.6 mm and leaves automatic rule colors disabled',()=>{
		const {dom,el}=openWorkbench();
		try{
			expect(el('thickness').value).toBe('1.6');
			expect(el('autoRuleColors').checked).toBe(false);
			expect(el('ruleColorHint').textContent).toContain('#000000');
			expect(el('applyBtn').textContent).toBe('生成设计规则');
			expect(el('restoreBtn')).toBeNull();
		}finally{dom.window.close();}
	});
	it('returns after saving the generated configuration before any active-rule mutation',()=>{
		const source=fs.readFileSync('iframe/app.js','utf8');
		const applyStart=source.indexOf('async function apply()');
		const generatedReturn=source.indexOf("toast(`设计规则已生成：${configurationName}`);\n\t\t\treturn;",applyStart);
		const generationPath=source.slice(applyStart,generatedReturn);
		expect(applyStart).toBeGreaterThanOrEqual(0);
		expect(generatedReturn).toBeGreaterThan(applyStart);
		expect(generationPath).toContain('saveRuleConfiguration');
		expect(generationPath).not.toContain('overwriteCurrentRuleConfiguration');
		expect(generationPath).not.toContain('overwriteNetRules');
		expect(generationPath).not.toContain('createDifferentialPair');
		expect(generationPath).not.toContain('createNetClass');
		expect(generationPath).not.toContain('setDocumentSource');
		expect(generationPath).not.toContain('setNetColor');
	});
	it('deletes an impedance configuration and invalidates its calculated plan',async()=>{
		const {dom,el}=openWorkbench();
		try{
			el('scanBtn').click();await flush();
			el('impedanceRows').querySelector('select[id^="lower_"]').value='2';
			el('calculateBtn').click();await flush();
			expect(el('applyBtn').disabled).toBe(false);
			el('impedanceRows').querySelector('[data-delete-impedance]').click();
			expect(el('impedanceRows').querySelector('[data-group]')).toBeNull();
			expect(el('netRows').textContent).toContain('普通');
			expect(el('planMeta').textContent).toContain('已删除');
			expect(el('applyBtn').disabled).toBe(true);
			expect(el('ruleMetric').textContent).toBe('0');
		}finally{dom.window.close();}
	},20000);
	it('uses black by default and assigns distinct high-contrast colors when enabled',async()=>{
		const {dom,win,el}=openWorkbench(['CLK_Z50','USB_DP','USB_DM','+3V3']);
		try{
			el('scanBtn').click();await flush();
			for(const select of el('impedanceRows').querySelectorAll('select[id^="lower_"]')) select.value='2';
			el('calculateBtn').click();await flush();
			let colors=[...win.document.querySelectorAll('.color-swatch')].map((node:any)=>node.style.backgroundColor);
			expect(colors.length).toBeGreaterThanOrEqual(3);
			expect(colors.every((color:string)=>color==='rgb(0, 0, 0)')).toBe(true);
			el('autoRuleColors').checked=true;el('autoRuleColors').dispatchEvent(new win.Event('change'));await flush();
			colors=[...win.document.querySelectorAll('.color-swatch')].map((node:any)=>node.style.backgroundColor);
			expect(colors.every((color:string)=>color!=='rgb(0, 0, 0)')).toBe(true);
			expect(new Set(colors).size).toBe(colors.length);
			expect(el('ruleColorHint').textContent).toContain('高对比度');
		}finally{dom.window.close();}
	},20000);
	it('matches the website 8-layer 1.6 mm lists for both inner copper choices',async()=>{
		const {dom,win,el,network,results}=openWorkbench();
		try{
			el('layers').value='8';el('layers').dispatchEvent(new win.Event('change'));el('thickness').value='1.6';el('innerOz').value='0.5';el('outerOz').value='1';
			el('scanBtn').click();await flush();
			el('impedanceRows').querySelector('select[id^="lower_"]').value='2';
			el('calculateBtn').click();await flush();
			expect(el('statusTitle').textContent).toBe('计算完成');
			expect(el('stackTemplate').options).toHaveLength(14);
			expect(results.some(r=>r.geometry.H1===3.9134&&r.width===5.94&&r.verified)).toBe(true);
			expect([...el('stackTemplate').options].map((x:any)=>x.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('JLC08161H-3313')]));
			el('innerOz').value='1';el('calculateBtn').click();await flush();
			expect(el('statusTitle').textContent).toBe('计算完成');
			expect([...el('stackTemplate').options].map((x:any)=>x.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('JLC081611-2116D'),expect.stringContaining('JLC081611-2116H')]));
			expect(el('stackTemplate').options).toHaveLength(26);
			expect(el('planCards').textContent).toContain('6.63');
			expect(el('applyBtn').disabled).toBe(false);
			expect(network).not.toHaveBeenCalled();
		}finally{dom.window.close();}
	},20000);
	it('loads shared modes, computes and previews without a fetch or socket',async()=>{
		const {dom,el,network,results}=openWorkbench();
		try{
			el('scanBtn').click();await flush();
			el('impedanceRows').querySelector('select[id^="lower_"]').value='2';
			expect(el('impedanceRows').querySelector('select').options.length).toBe(12);
			el('calculateBtn').click();await flush();
			expect(el('statusTitle').textContent).toBe('计算完成');
			expect(el('planCards').textContent).toContain('JLC04161H-7628C');
			expect(el('planCards').textContent).toContain('JLC04161H-7628F');
			expect(el('stackTemplate').textContent).toContain('JLC04161H-3313A');
			expect(results.some(r=>r.geometry.H1===8.126&&r.width===13.57&&r.verified)).toBe(true);
			expect(results.some(r=>r.geometry.H1===8.2835&&r.width===14.12&&r.verified)).toBe(true);
			expect(el('planCards').textContent).toContain('46.96');
			expect(el('stackMeta').textContent).toContain('运行时完全离线');
			expect(network).not.toHaveBeenCalled();
		}finally{dom.window.close();}
	},20000);
	it('allows inspecting unverified estimates but disables rule application',async()=>{
		const {dom,el,win,network}=openWorkbench();
		try{
			el('scanBtn').click();await flush();
			el('impedanceRows').querySelector('select[id^="lower_"]').value='2';
			el('impedanceRows').querySelector('input[id^="target_"]').value='51';
			el('calculateBtn').click();await flush();
			expect(el('applyBtn').disabled).toBe(true);
			const estimate=[...win.document.querySelectorAll('[data-stack]')].find((x:any)=>x.textContent==='查看估算方案') as any;
			expect(estimate).toBeDefined();estimate.click();
			expect(el('stackTitle').textContent).toContain('未验证');
			expect(el('previewBtn')).toBeNull();
			expect(el('applyBtn').disabled).toBe(true);
			expect(network).not.toHaveBeenCalled();
		}finally{dom.window.close();}
	},20000);
	it('rejects changed or out-of-range inputs before any rule write',async()=>{
		const {dom,el,network}=openWorkbench();
		try{
			el('scanBtn').click();await flush();
			el('impedanceRows').querySelector('select[id^="lower_"]').value='2';
			el('calculateBtn').click();await flush();
			expect(el('applyBtn').disabled).toBe(false);
			el('impedanceRows').querySelector('input[id^="target_"]').value='51';
			el('applyBtn').click();await flush();
			expect(el('statusDetail').textContent).toContain('计算参数已变化');
			el('impedanceRows').querySelector('input[id^="width_"]').value='101';
			el('calculateBtn').click();await flush();
			expect(el('statusTitle').textContent).toBe('计算失败');
			expect(el('statusDetail').textContent).toContain('W1');
			expect(el('applyBtn').disabled).toBe(true);
			expect(network).not.toHaveBeenCalled();
		}finally{dom.window.close();}
	},20000);
	it('routes thick copper and asymmetric inner-layer geometry through the shared core',async()=>{
		const {dom,win,el,results,network}=openWorkbench();
		try{
			el('layers').value='4';el('thickness').value='2';el('outerOz').value='2';el('innerOz').value='2';
			el('scanBtn').click();await flush();
			el('impedanceRows').querySelector('select[id^="lower_"]').value='2';
			el('calculateBtn').click();await flush();
			expect(results.length).toBeGreaterThan(0);
			expect(results.every(r=>r.geometry.T1===2.85&&r.geometry.C2===0.8)).toBe(true);
			results.length=0;
			const mode=el('impedanceRows').querySelector('select[id^="mode_"]');
			mode.value='OffsetStripline1B1A';mode.dispatchEvent(new win.Event('change'));
			el('impedanceRows').querySelector('select[id^="upper_"]').value='1';
			el('impedanceRows').querySelector('select[id^="lower_"]').value='3';
			el('calculateBtn').click();await flush();
			expect(results.length).toBeGreaterThan(0);
			expect(results.some(r=>Math.abs(r.geometry.H1-r.geometry.H2)>1)).toBe(true);
			expect(network).not.toHaveBeenCalled();
		}finally{dom.window.close();}
	},20000);
});
