import test from 'node:test';
import assert from 'node:assert/strict';
import TemplateService,{validateTemplate} from '../services/TemplateService.js';
const input={cf_clave:'TEST',cf_cliente:'1',cf_proyecto:'2',cf_abogado:'3',cf_tarea:'4',cf_registrar_como:'Horas',cf_horas_facturables:'5.00',cf_no_facturables:'0.00',cf_reference_number:'REF'};
const auth={getAccessToken:async()=> 'mock'};
test('paginates template records, retains Books IDs and clave',async()=>{
 const service=new TemplateService('123',{auth,http:{get:async(url,opts)=>{assert.ok(url.endsWith('/cm_plantillas_time_entry'));assert.equal(opts.params.organization_id,'123');return {data:{code:0,module_records:[{...input,module_record_id:String(opts.params.page)}],page_context:{has_more_page:opts.params.page===1}}}}}});
 const rows=await service.list();assert.equal(rows.length,2);assert.equal(rows[0].cf_clave,'TEST');assert.equal(rows[0].cf_tarea,'4');
});
test('validates before writing and ignores UI fields not in module',async()=>{
 let calls=0;const service=new TemplateService('123',{auth,http:{post:async(url,payload)=>{calls++;assert.equal(payload.description,undefined);return {data:{code:0,module_record_hash:{...payload,module_record_id:'99'}}}}}});
 await assert.rejects(service.create({...input,cf_clave:''}),e=>e.status===400);assert.equal(calls,0);
 assert.equal((await service.create({...input,description:'not stored'})).id,'99');
 for(const patch of [{cf_abogado:'abc'},{cf_registrar_como:'Cronómetro'},{cf_horas_facturables:'-1'},{cf_reference_number:'x'.repeat(256)}])assert.throws(()=>validateTemplate({...input,...patch}));
});
test('accepts documented array and detail module_fields create responses',async()=>{
 for(const record of [[{module_record_id:'99',...input}],{module_record_id:'99',module_fields:Object.entries(input).map(([api_name,value])=>({api_name,value}))}]){
  const service=new TemplateService('123',{auth,http:{post:async()=>({data:{code:0,module_record:record}})}});
  assert.equal((await service.create(input)).cf_clave,'TEST');
 }
});
test('network loss is uncertain and never retried automatically',async()=>{
 let calls=0;const service=new TemplateService('123',{auth,http:{post:async()=>{calls++;throw new Error('network')}}});
 await assert.rejects(service.create(input),e=>e.outcome_unknown===true);assert.equal(calls,1);
});
test('provider rejection remains retryable without exposing headers',async()=>{
 const service=new TemplateService('123',{auth,http:{post:async()=>{throw {response:{status:400},config:{headers:{Authorization:'secret'}}}}}});
 await assert.rejects(service.create(input),e=>e.outcome_unknown===false&&!e.message.includes('secret'));
});
