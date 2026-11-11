import test from 'node:test';
import assert from 'node:assert/strict';
import app, { CATALOGS } from '../index.js';

// Sin red: sin contexto de Catalyst la conexión falla antes de salir, y debe responder 503 en JSON.
test('rutas: catálogos permitidos, el resto 404 y sin conexión 503', async () => {
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const original = console.error; console.error = () => {};
    try {
        let r = await fetch(`${base}/636939444/prebills`);
        assert.equal(r.status, 404);
        r = await fetch(`${base}/636939444/a/b/c`);
        assert.equal(r.status, 404); assert.equal((await r.json()).stage, undefined);
        r = await fetch(`${base}/abc/clientes`);
        assert.equal(r.status, 400);
        for (const catalog of Object.keys(CATALOGS)) {
            r = await fetch(`${base}/636939444/${catalog}`);
            assert.equal(r.status, 503, catalog);
            assert.equal((await r.json()).stage, 'connection');
        }
    } finally { server.close(); console.error = original; }
});

test('rutas de escritura de tiempos: validan sin red; con datos válidos fallan en la conexión (503)', async () => {
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/636939444`;
    const send = (method, path, body) => fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const original = console.error; console.error = () => {};
    try {
        // El cuerpo anterior (IDs de Books) ya no se acepta: nunca llega a escribir.
        assert.equal((await send('POST', '/tiempos', { project_id: '446794000019007841', user_id: '1', log_time: '01:00' })).status, 400);
        assert.equal((await send('PATCH', '/tiempos/abc', { horas: 1 })).status, 400);
        assert.equal((await send('PUT', '/tiempos/73', {})).status, 404);
        const r = await send('POST', '/tiempos', { abogado_id: 6, proyecto_id: 8, fecha: '2026-11-11', horas: 1, tarea_estandar_id: 1, facturable: true });
        assert.equal(r.status, 503); assert.equal((await r.json()).stage, 'connection');
        assert.equal((await send('DELETE', '/tiempos/73')).status, 503);
    } finally { server.close(); console.error = original; }
});
