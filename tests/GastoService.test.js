import test from 'node:test';
import assert from 'node:assert/strict';
import GastoService, { validateGasto } from '../services/GastoService.js';
import PrebillApiClient from '../core/PrebillApiClient.js';

const input = { proyecto_id: 18, fecha: '2026-11-09', monto: 640.5, descripcion: 'Taxis a juzgados', categoria_id: 5, tipo: 'gasto', facturable: true, pagado_por: 'despacho' };

function fixture(response = { id: 22 }) {
    const calls = [];
    const api = { async request(method, path, opts) { calls.push({ method, path, opts }); return response; } };
    return { service: new GastoService('636939444', { api }), calls };
}

test('valida antes de llamar a la API', async () => {
    for (const patch of [{ proyecto_id: '18' }, { fecha: '2026-02-30' }, { monto: 0 }, { monto: 1.234 }, { monto: '10' }, { tipo: 'otro' }, { facturable: 1 }, { pagado_por: 'abogado' }, { categoria_id: 'x' }]) {
        const { service, calls } = fixture();
        await assert.rejects(service.create({ ...input, ...patch }), e => e.status === 400);
        assert.equal(calls.length, 0);
    }
    const { service } = fixture();
    await assert.rejects(new GastoService('abc', { api: {} }).create(input), e => e.status === 400);
    await assert.rejects(service.get('1; drop'), e => e.status === 400);
});

test('solo reenvía campos permitidos y convierte facturable a 0/1', async () => {
    const { service, calls } = fixture();
    await service.create({ ...input, extra: 'x', moneda: 'USD' });
    assert.deepEqual(calls[0].opts.data, { ...input, facturable: 1 });
    assert.equal(calls[0].method, 'post'); assert.equal(calls[0].path, '/gastos');
});

test('pagado por abogado exige abogado_id', () => {
    assert.throws(() => validateGasto('1', { ...input, pagado_por: 'abogado' }), /abogado/);
    assert.equal(validateGasto('1', { ...input, pagado_por: 'abogado', abogado_id: 15 }).abogado_id, 15);
});

test('al editar no se manda el proyecto', async () => {
    const { service, calls } = fixture();
    await service.update('22', input);
    assert.equal(calls[0].method, 'patch'); assert.equal(calls[0].path, '/gastos/22');
    assert.equal(calls[0].opts.data.proyecto_id, undefined);
});

test('respuesta sin id se marca como incierta', async () => {
    const { service } = fixture({ ok: true });
    await assert.rejects(service.create(input), e => e.status === 502 && e.outcome_unknown === true);
});

function client(http) {
    return new PrebillApiClient('636939444', { http, config: { async get() { return { endpoint: 'https://example.test/api/', token: 'secret-token' }; } } });
}

test('cliente: token en query string y sin doble slash', async () => {
    let seen;
    const api = client({ async request(options) { seen = options; return { data: { id: 1 } }; } });
    await api.request('get', '/gastos/1');
    assert.equal(seen.url, 'https://example.test/api/gastos/1');
    assert.equal(seen.params.token, 'secret-token');
    assert.equal(seen.headers, undefined);
});

test('cliente: 400/409/422 conservan el mensaje de la API', async () => {
    for (const status of [400, 404, 409, 422]) {
        const api = client({ async request() { throw { response: { status, data: { error: 'Mensaje ' + status } } }; } });
        await assert.rejects(api.request('post', '/gastos'), e => e.status === status && e.message === 'Mensaje ' + status && e.outcome_unknown === false);
    }
});

test('cliente: pérdida de red en escritura es incierta y no se reintenta', async () => {
    let calls = 0;
    const api = client({ async request() { calls++; throw Object.assign(new Error('timeout'), { config: { url: 'https://example.test/api/gastos?token=secret-token' } }); } });
    await assert.rejects(api.request('post', '/gastos'), e => e.status === 502 && e.outcome_unknown === true && !e.message.includes('secret'));
    assert.equal(calls, 1);
});

test('cliente: 401 o respuesta HTML se vuelven 502 genérico', async () => {
    const unauthorized = client({ async request() { throw { response: { status: 401, data: '<html>' } }; } });
    await assert.rejects(unauthorized.request('get', '/gastos/1'), e => e.status === 502 && e.outcome_unknown === false);
    const html = client({ async request() { return { data: '<html>Not Found</html>' }; } });
    await assert.rejects(html.request('get', '/gastos/1'), e => e.status === 502);
});

test('cliente: sin configuración responde 503', async () => {
    const api = new PrebillApiClient('1', { http: {}, config: { async get() { return { endpoint: '', token: '' }; } } });
    await assert.rejects(api.request('get', '/gastos'), e => e.status === 503);
});
