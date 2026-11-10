import test from 'node:test';
import assert from 'node:assert/strict';
import TimeEntryService, { validateTimeEntry } from '../services/TimeEntryService.js';
const input = { project_id: '101', user_id: '202', task_name: 'Estándar', log_date: '2026-10-11', log_time: '01:30', is_billable: true, notes: 'Actividad', cf_referencia: 'Referencia' };
function fixture(pages = [[{ task_id: '303', task_name: 'Estándar' }]], failStage) {
    const calls = [];
    const http = {
        async get(url, options) { calls.push({ method: 'GET', url, options }); const tasks = pages[options.params.page - 1]; return { data: { code: 0, tasks, page_context: { has_more_page: options.params.page < pages.length } } }; },
        async post(url, body, options) {
            calls.push({ method: 'POST', url, body, options });
            if (url.endsWith(failStage || 'NEVER')) throw Object.assign(new Error('private credentials'), { response: { status: 400, data: { code: 42 } } });
            return { data: url.endsWith('/tasks') ? { code: 0, task: { task_id: '404' } } : { code: 0, time_entry: { time_entry_id: '505' } } };
        }
    };
    const auth = { async getAccessToken() { calls.push({ method: 'AUTH' }); return 'secret'; } };
    return { service: new TimeEntryService('123', { http, auth }), calls, http };
}
test('reuses matching task and forwards only supported fields', async () => {
    const { service, calls } = fixture();
    const result = await service.create({ ...input, cliente: 'ignored', plantilla: 'ignored', task_id: '999', arbitrary: true });
    assert.equal(result.task_id, '303'); assert.equal(result.task_created, false);
    const posts = calls.filter(c => c.method === 'POST'); assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].body, { project_id: '101', user_id: '202', log_date: input.log_date, log_time: '01:30', is_billable: true, notes: 'Actividad', task_id: '303', timesheet_custom_fields: [{ api_name: 'cf_referencia', value: 'Referencia' }] });
    assert.equal(posts[0].options.params.organization_id, '123');
});
test('creates missing task before time entry', async () => {
    const { service, calls } = fixture([[]]); const result = await service.create(input);
    assert.equal(result.task_created, true); const posts = calls.filter(c => c.method === 'POST');
    assert.deepEqual(posts[0].body, { task_name: 'Estándar' }); assert.equal(posts[1].body.task_id, '404');
});
test('searches all pages and matches case/outer whitespace', async () => {
    const { service, calls } = fixture([[{ task_id: '9', task_name: 'Otra' }], [{ task_id: '303', task_name: ' ESTÁNDAR ' }]]);
    assert.equal((await service.create(input)).task_created, false); assert.equal(calls.filter(c => c.method === 'GET').length, 2);
});
test('ambiguous or inactive tasks never create time', async () => {
    for (const tasks of [[{ task_id: '1', task_name: 'Estándar' }, { task_id: '2', task_name: 'estándar' }], [{ task_id: '1', task_name: 'Estándar', status: 'inactive' }]]) {
        const { service, calls } = fixture([tasks]); await assert.rejects(service.create(input), e => e.status === 409); assert.equal(calls.filter(c => c.method === 'POST').length, 0);
    }
});
test('validates before authentication or writes', async () => {
    for (const patch of [{ project_id: 123 }, { user_id: '' }, { log_date: '2026-02-30' }, { log_time: '1.55' }, { log_time: '00:00' }, { notes: 'x'.repeat(501) }, { is_billable: 'true' }, { task_name: '' }, { begin_time: '09:00', end_time: '10:00' }]) {
        const { service, calls } = fixture(); await assert.rejects(service.create({ ...input, ...patch }), e => e.status === 400); assert.equal(calls.length, 0);
    }
});
test('range and timer payloads', () => {
    const { log_time, ...rest } = input;
    assert.equal(validateTimeEntry('123', { ...rest, begin_time: '09:00', end_time: '10:00' }).payload.begin_time, '09:00');
    assert.equal(validateTimeEntry('123', { ...rest, start_timer: true }).payload.start_timer, 'true');
    assert.throws(() => validateTimeEntry('123', { ...rest, begin_time: '17:00', end_time: '09:00' }));
});
test('task creation failure stops time creation and sanitizes error', async () => {
    const { service, calls } = fixture([[]], '/tasks');
    await assert.rejects(service.create(input), e => e.stage === 'create_task' && e.status === 502 && !e.message.includes('private') && !e.outcome_unknown);
    assert.equal(calls.filter(c => c.method === 'POST').length, 1);
});
test('reports created task when time fails', async () => {
    const { service } = fixture([[]], '/timeentries');
    await assert.rejects(service.create(input), e => e.stage === 'create_time_entry' && e.task_id === '404' && e.task_created && e.books_code === 42);
});
test('does not treat malformed lists as an empty project', async () => {
    const { service, http } = fixture(); http.get = async () => ({ data: { code: 0 } });
    await assert.rejects(service.create(input), e => e.stage === 'list_tasks');
});
test('write timeout reports unknown outcome and never retries automatically', async () => {
    const { service, http } = fixture(); let attempts = 0;
    http.post = async () => { attempts++; throw new Error('timeout'); };
    await assert.rejects(service.create(input), e => e.outcome_unknown && e.stage === 'create_time_entry'); assert.equal(attempts, 1);
});

test('Books singular task array is reused, including pagination', async () => {
    const { service, http, calls } = fixture();
    http.get = async (url, options) => ({ data: { code: 0, task: options.params.page === 1 ? [{ task_id: '9', task_name: 'Otra' }] : [{ task_id: '303', task_name: 'Estándar' }], page_context: { has_more_page: options.params.page === 1 } } });
    const result = await service.create(input);
    assert.equal(result.task_id, '303'); assert.equal(result.task_created, false);
    assert.equal(calls.filter(c => c.method === 'POST').length, 1);
});
test('empty singular task array creates a task; malformed singular object stops writes', async () => {
    const { service, http } = fixture();
    http.get = async () => ({ data: { code: 0, task: [] } });
    assert.equal((await service.create(input)).task_created, true);
    http.get = async () => ({ data: { code: 0, task: {} } });
    await assert.rejects(service.create(input), e => e.stage === 'list_tasks' && e.status === 502 && e.message.includes('formato inesperado'));
});

test('timer creation sends the native Books flag without a fixed duration', async () => {
    const {service,calls}=fixture(); const {log_time,...rest}=input;
    await service.create({...rest,start_timer:true});
    const body=calls.find(c=>c.method==='POST').body;
    assert.equal(body.start_timer,'true'); assert.equal(body.log_time,undefined);
    assert.equal(body.begin_time,undefined); assert.equal(body.end_time,undefined);
});

test('get time detail scopes Books request by organization', async () => {
    const {service,http}=fixture();
    http.get=async(url,options)=>{assert.ok(url.endsWith('/projects/timeentries/505'));assert.equal(options.params.organization_id,'123');return {data:{code:0,time_entry:{time_entry_id:'505'}}}};
    assert.equal((await service.get('505')).time_entry_id,'505');
    await assert.rejects(service.get('../bad'),e=>e.status===400);
});
test('update preserves original task ID and issues PUT only', async () => {
    const {service,http,calls}=fixture();
    http.get=async()=>({data:{code:0,time_entry:{time_entry_id:'505',project_id:'101',task_id:'303',task_name:'Estándar',timesheet_custom_fields:[{api_name:'cf_other',customfield_id:'88',value:'keep'}]}}});
    let puts=0;
    http.put=async(url,body)=>{puts++;assert.ok(url.endsWith('/505'));assert.equal(body.task_id,'303');assert.equal(body.timesheet_custom_fields[0].value,'keep');return {data:{code:0,time_entry:{time_entry_id:'505'}}}};
    assert.equal((await service.create(input,'505')).time_entry.time_entry_id,'505');assert.equal(puts,1);assert.equal(calls.filter(c=>c.method==='POST').length,0);
});
test('update of missing or running time stops before writes', async () => {
    const {service,http,calls}=fixture();
    http.get=async()=>{throw {response:{status:404}}};
    await assert.rejects(service.create(input,'505'),e=>e.status===404);
    http.get=async()=>({data:{code:0,time_entry:{time_entry_id:'505',timer_started_at:'running'}}});
    await assert.rejects(service.create(input,'505'),e=>e.status===409);
    assert.equal(calls.filter(c=>c.method==='POST').length,0);
});
