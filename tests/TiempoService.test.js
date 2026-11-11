import test from 'node:test';
import assert from 'node:assert/strict';
import TiempoService, { validateTiempo } from '../services/TiempoService.js';

const input = { abogado_id: 6, proyecto_id: 8, fecha: '2026-11-11', horas: 2.5, descripcion: 'Revisión del contrato', tarea_estandar_id: 1, facturable: true };

function fixture(response = { id: 73, books_estado: 'respaldado' }) {
    const calls = [];
    const api = { async request(method, path, opts) { calls.push({ method, path, opts }); return response; } };
    return { service: new TiempoService('636939444', { api }), calls };
}

test('valida antes de llamar a la API', async () => {
    for (const patch of [{ abogado_id: '6' }, { proyecto_id: 0 }, { fecha: '2026-02-30' }, { horas: 0 }, { horas: 25 }, { horas: 1.234 }, { horas: '2' },
        { facturable: 1 }, { descripcion: 'x'.repeat(501) }, { tarea_estandar_id: 'x' }, { tarea_estandar_id: undefined }, { tarea: 'Otra' }]) {
        const { service, calls } = fixture();
        await assert.rejects(service.create({ ...input, ...patch }), e => e.status === 400, JSON.stringify(patch));
        assert.equal(calls.length, 0);
    }
    await assert.rejects(new TiempoService('abc', { api: {} }).create(input), e => e.status === 400);
    await assert.rejects(fixture().service.get('1; drop'), e => e.status === 400);
    await assert.rejects(fixture().service.remove('../prebills'), e => e.status === 400);
});

test('solo reenvía campos permitidos y convierte facturable a 0/1', async () => {
    const { service, calls } = fixture();
    await service.create({ ...input, extra: 'x', tarifa_aplicada: 9999, liberado: 1 });
    assert.equal(calls[0].method, 'post'); assert.equal(calls[0].path, '/tiempos');
    assert.deepEqual(calls[0].opts.data, { ...input, facturable: 1 });
});

test('tarea en texto libre en lugar de la estándar', () => {
    const { tarea_estandar_id, ...rest } = input;
    assert.equal(tarea_estandar_id, 1);
    assert.deepEqual(validateTiempo('1', { ...rest, tarea: '  Junta con cliente ', facturable: false }), { ...rest, tarea: 'Junta con cliente', facturable: 0 });
});

test('editar: PATCH sin abogado ni proyecto', async () => {
    const { service, calls } = fixture();
    await service.update('73', { ...input, horas: 3 });
    assert.equal(calls[0].method, 'patch'); assert.equal(calls[0].path, '/tiempos/73');
    assert.equal(calls[0].opts.data.abogado_id, undefined); assert.equal(calls[0].opts.data.proyecto_id, undefined);
    assert.equal(calls[0].opts.data.horas, 3);
});

test('borrar usa DELETE /tiempos/:id', async () => {
    const { service, calls } = fixture({ ok: true });
    await service.remove('73');
    assert.deepEqual([calls[0].method, calls[0].path], ['delete', '/tiempos/73']);
});

test('respuesta sin id se marca como incierta', async () => {
    const { service } = fixture({ ok: true });
    await assert.rejects(service.create(input), e => e.status === 502 && e.outcome_unknown === true);
});
