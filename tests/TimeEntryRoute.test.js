import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../index.js';
import TimeEntryService from '../services/TimeEntryService.js';
const handler = app.router.stack.find(layer => layer.route?.path === '/:organizationId/tiempos' && layer.route.methods.post).route.stack[0].handle;
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
test('HTTP route returns validation errors before provider access', async () => {
    const res = response(); await handler({ params: { organizationId: 'invalid' }, body: {} }, res);
    assert.equal(res.statusCode, 400); assert.equal(res.body.stage, 'validation');
});
test('HTTP route returns 201 and service result', async () => {
    const original = TimeEntryService.prototype.create;
    try {
        TimeEntryService.prototype.create = async function(body) { assert.equal(this.organizationId, '123'); assert.equal(body.project_id, '101'); return { task_id: '303', task_created: false, time_entry: { time_entry_id: '505' } }; };
        const res = response(); await handler({ params: { organizationId: '123' }, body: { project_id: '101' } }, res);
        assert.equal(res.statusCode, 201); assert.equal(res.body.time_entry.time_entry_id, '505');
    } finally { TimeEntryService.prototype.create = original; }
});
