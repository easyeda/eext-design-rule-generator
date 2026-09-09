import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildRequest, matchResult, Oracle, parameterDigest, validateResult } from '../../scripts/jlc-oracle.mjs';

describe('official capture correlation',()=>{
	it('reproduces the server digest for every archived official mode and argument set',()=>{
		for(const file of ['samples.jsonl','final-audit.jsonl'])for(const line of fs.readFileSync(`fixtures/calibration/${file}`,'utf8').trim().split('\n')){
			const s=JSON.parse(line);
			if(!s.result)continue;
			expect(parameterDigest(s.request.impedance_calc_mark,s.request.impedance_calc_arg),s.sampleId||s.auditId).toBe(s.response.paramMd5);
		}
	});
	it.each(['direct','wrapped','websocket'])('accepts a correlated result over %s without a network connection',async transport=>{
		const oracle=Object.create(Oracle.prototype);
		oracle.uuid='test-session';
		oracle.lastStart=0;
		oracle.socket=new EventEmitter();
		oracle.open=async()=>{};
		const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
			const request=JSON.parse(String(init!.body));
			const response={...request,impedance_calc_status:0,impedance_calc_result:{dResultValid:1,dImpedance:50}};
			return {ok:true,status:200,json:async()=>{
				if(transport==='websocket'){
					oracle.socket.emit('message',JSON.stringify(response));
					return {success:true,result:'success',body:null};
				}
				return transport==='direct'?response:{success:true,result:'success',body:response};
			}} as Response;
		});
		try{
			const captured=await oracle.calculate('CoatedMicrostrip1B',{W1:8});
			expect(captured.result.dImpedance).toBe(50);
			expect(oracle.socket.listenerCount('message')).toBe(0);
		}finally{fetch.mockRestore();}
	});
	it('rejects cross-request and digest mismatches',()=>{
		const request=buildRequest('CoatedMicrostrip1B',{W1:8},'session','request');
		const response={...request,impedance_calc_status:0,impedance_calc_result:{dResultValid:1,dImpedance:50}};
		expect(matchResult(response,request)).toEqual(response);
		for(const key of ['uuid','accessId','paramMd5','impedance_calc_mark'])expect(matchResult({...response,[key]:'different'},request)).toBeNull();
	});
	it('requires valid finite positive results, not an HTTP success acknowledgement',()=>{
		expect(()=>validateResult({success:true,body:null})).toThrow();
		expect(()=>validateResult({impedance_calc_status:0,impedance_calc_result:{dResultValid:0,dImpedance:50}})).toThrow();
		expect(()=>validateResult({impedance_calc_status:0,impedance_calc_result:{dResultValid:1,dImpedance:Infinity}})).toThrow();
	});
});
