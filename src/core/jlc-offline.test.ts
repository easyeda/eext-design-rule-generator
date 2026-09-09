import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { calculateRow, dimensionsAtWidth, geometryFromStack, isProductionTemplate, parseStack, processFor, regionKey, solveDimensions, PROCESS } from './jlc-offline';
import { validateJlcGeometry } from './jlc-surrogate';
import type { StackupTemplate } from './stackup';

const context: any = {};
for (const file of ['stackups','jlc-models','jlc-calibration']) vm.runInNewContext(fs.readFileSync(`iframe/${file}.js`,'utf8'),context);
const templates: StackupTemplate[] = context.__ADR_STACKUPS__;
const row = { mode: 'CoatedMicrostrip1B', target:50, layer:1, upperRef:0, lowerRef:2, width:8, gap:5, distance:8 };
const stack = parseStack(templates.find(t=>t.code==='JLC04161H-3313A'&&t.outerOz===1&&t.innerOz===0.5)!);

describe('shared offline geometry and solver',()=>{
	it('matches website bare-board span without fabricating copper layers',()=>{
		const template=templates.find(t=>t.id==='8eadf2033e9344beba8e886bed3ec981')!;
		const parsed=parseStack(template);
		expect(parsed.copper).toHaveLength(6);
		expect(parsed.calculationGaps[2]-parsed.gaps[2]).toBeCloseTo(0.0304,10);
		const g=geometryFromStack(parsed,{...row,mode:'OffsetStripline1B1A',layer:3,upperRef:2,lowerRef:4});
		expect(g.H2).toBe(38.4409);
	});
	it('rejects invalid coating values before selecting any RBF fallback',()=>{
		const g=geometryFromStack(stack,row);
		expect(()=>validateJlcGeometry(row.mode,{...g,C2:NaN})).toThrow(/C2/);
		expect(()=>validateJlcGeometry(row.mode,{...g,C1:-1})).toThrow(/C1/);
		expect(()=>validateJlcGeometry(row.mode,{...g,CEr:0})).toThrow(/CEr/);
	});
	it('matches the current website production set instead of historical templates',()=>{
		const production=templates.filter(isProductionTemplate);
		const queries=JSON.parse(fs.readFileSync('fixtures/calibration/exact-query-recheck.json','utf8'));
		for(const c of queries.cases){
			const q=c.request;
			const visible=c.response.body.list.filter((t:any)=>!t.receptionDisplayName.includes('自定义')&&!t.receptionDisplayName.includes('无要求'));
			const actual=production.filter(t=>t.layers===q.plateLayerNumber&&t.thickness===q.plateThickness&&t.outerOz===q.cuprumThickness&&t.innerOz===q.innerCopperThickness&&t.boardType===q.boardType);
			expect(actual.map(t=>t.id).sort()).toEqual(visible.map((t:any)=>t.impedanceDefaultTemplateAccessId).sort());
		}
		expect(isProductionTemplate({...stack.template,thickness:99})).toBe(false);
		const changed=structuredClone(stack.template);
		changed.materials.find(m=>m.d)!.d!+=0.001;
		expect(isProductionTemplate(changed)).toBe(false);
	});
	it('distinguishes physical copper and process copper and preserves the website Er convention',()=>{
		const g=geometryFromStack(stack,row);
		expect(stack.copper[0]).toBe(0.035);
		expect(g).toMatchObject({H1:8.126,Er1:4.3,T1:1.6,W1:8,W2:7.5,C1:1,C2:0.6});
		expect(processFor(2,true).copper.traceCopperThickness).toBe(2.85);
		expect(processFor(2,true).coverlay.coatingAboveTrace).toBe(0.8);
	});
	it('maps asymmetrical inner H1/H2 and includes signal copper once',()=>{
		const g=geometryFromStack(stack,{...row,mode:'OffsetStripline1B1A',layer:2,upperRef:1,lowerRef:3});
		expect(g.H1).toBeCloseTo(1.065/0.0254,3);
		expect(g.H2).toBeCloseTo((0.2064+0.0152)/0.0254,3);
		const mirror=geometryFromStack(stack,{...row,mode:'OffsetStripline1B1A',layer:3,upperRef:2,lowerRef:4});
		expect(mirror).toEqual(g);
	});
	it('rejects invalid directions, missing references and corrupted stackups',()=>{
		expect(()=>geometryFromStack(stack,{...row,lowerRef:1})).toThrow(/参考层/);
		expect(()=>geometryFromStack(stack,{...row,mode:'OffsetStripline1B1A',layer:2,upperRef:1,lowerRef:0})).toThrow(/两个参考/);
		expect(()=>parseStack({...stack.template,layers:2})).toThrow(/层数/);
	});
	it('treats a bare core as dielectric, not two fabricated copper layers',()=>{
		const t={...stack.template,layers:2,materials:[{type:1,top:0.035},{type:3,d:0.55,er:4.48},{type:1,top:0.035}]};
		expect(parseStack(t).copper).toHaveLength(2);
		expect(parseStack(t).gaps).toEqual([0.55]);
	});
	it('includes intermediate copper for non-adjacent references',()=>{
		const g=geometryFromStack(stack,{...row,lowerRef:4});
		expect(g.H1).toBeCloseTo((0.2064*2+1.065+0.0152*2)/0.0254,3);
	});
	it('preserves coupled dimensions during every solve evaluation without clamping',()=>{
		const base={H1:5,Er1:4.3,T1:1.6,W1:8,W2:7.5,S1:10,D1:8};
		const solved=solveDimensions('DiffCoatedCoplanarWaveguideWithLowerGnd1B',base,60,g=>{
			expect(g.W1+g.S1!).toBeCloseTo(18,8);
			expect(g.W1+2*g.D1!).toBeCloseTo(24,8);
			return 100-g.W1*5;
		},true);
		expect(solved.W1).toBe(8);
		expect(()=>solveDimensions('DiffEdgeCoupledCoatedMicrostrip1B',base,1,()=>90,true)).toThrow(/无解/);
		expect(dimensionsAtWidth('DiffEdgeCoupledCoatedMicrostrip1B',base,20,true).S1).toBe(-2);
	});
	it('rejects non-finite values and unreachable targets',()=>{
		const g=geometryFromStack(stack,row);
		expect(()=>validateJlcGeometry(row.mode,{...g,H1:Infinity})).toThrow(/H1/);
		expect(()=>solveDimensions(row.mode,g,200,()=>50)).toThrow(/无解/);
		expect(()=>solveDimensions(row.mode,g,50,()=>NaN)).toThrow(/无效/);
	});
	it('does not transfer verification across process, spacing or target changes',()=>{
		const g=geometryFromStack(stack,row);
		expect(regionKey(row.mode,{...g,T1:2.85})).not.toBe(regionKey(row.mode,g));
		const empty={version:'test',processVersion:PROCESS.version,regions:{}};
		expect(calculateRow(stack,row,false,empty,context.__ADR_JLC_MODELS__).verified).toBe(false);
		expect(()=>calculateRow(stack,{...row,mode:'DiffEdgeCoupledCoatedMicrostrip1B',width:0},true,empty,context.__ADR_JLC_MODELS__)).toThrow(/初始 W1/);
	});
});
