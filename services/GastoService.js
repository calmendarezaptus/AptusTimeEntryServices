import PrebillApiClient from '../core/PrebillApiClient.js';

export class GastoError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

const orgId = value => typeof value === 'string' && /^\d+$/.test(value);
const localId = value => Number.isInteger(value) && value > 0;
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export const TIPOS = ['gasto', 'reembolso'];
export const PAGADO_POR = ['despacho', 'caja_chica', 'abogado'];

// Valida y arma el cuerpo para ReportesSandbox. Con `update` el proyecto no se manda:
// la API no permite cambiarlo (fija la moneda del gasto).
export function validateGasto(organizationId, body, { update = false } = {}) {
    if (!orgId(organizationId)) throw new GastoError('Organización inválida.');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new GastoError('Se requiere un objeto JSON.');
    const payload = {};
    if (!update) {
        if (!localId(body.proyecto_id)) throw new GastoError('proyecto_id debe ser el ID del proyecto en Aptus (entero).');
        payload.proyecto_id = body.proyecto_id;
    }
    if (!isDate(body.fecha)) throw new GastoError('fecha debe ser una fecha válida YYYY-MM-DD.');
    payload.fecha = body.fecha;
    if (typeof body.monto !== 'number' || !Number.isFinite(body.monto) || body.monto <= 0) throw new GastoError('monto debe ser un número mayor que 0.');
    if (Math.round(body.monto * 100) !== body.monto * 100) throw new GastoError('monto admite como máximo 2 decimales.');
    payload.monto = body.monto;
    if (body.descripcion !== undefined) {
        if (typeof body.descripcion !== 'string') throw new GastoError('descripcion debe ser texto.');
        payload.descripcion = body.descripcion;
    }
    if (body.categoria_id !== undefined && body.categoria_id !== null) {
        if (!localId(body.categoria_id)) throw new GastoError('categoria_id debe ser un entero.');
        payload.categoria_id = body.categoria_id;
    }
    if (!TIPOS.includes(body.tipo)) throw new GastoError('tipo debe ser "gasto" o "reembolso".');
    payload.tipo = body.tipo;
    if (typeof body.facturable !== 'boolean') throw new GastoError('facturable debe ser booleano.');
    payload.facturable = body.facturable ? 1 : 0;
    if (!PAGADO_POR.includes(body.pagado_por)) throw new GastoError('pagado_por debe ser "despacho", "caja_chica" o "abogado".');
    payload.pagado_por = body.pagado_por;
    if (body.abogado_id !== undefined && body.abogado_id !== null) {
        if (!localId(body.abogado_id)) throw new GastoError('abogado_id debe ser un entero.');
        payload.abogado_id = body.abogado_id;
    }
    if (payload.pagado_por === 'abogado' && !payload.abogado_id) throw new GastoError('Indica qué abogado pagó el gasto.');
    return payload;
}

export default class GastoService {
    constructor(organizationId, { api = null, req = null } = {}) {
        this.organizationId = organizationId;
        this.api = api ?? new PrebillApiClient(organizationId, { req });
    }

    checkId(id) {
        if (!orgId(this.organizationId)) throw new GastoError('Organización inválida.');
        if (typeof id !== 'string' || !/^\d+$/.test(id)) throw new GastoError('ID de gasto inválido.');
    }

    static ensureGasto(data) {
        if (!data || !Number.isInteger(data.id)) {
            const error = new GastoError('El servicio de Aptus devolvió un gasto con formato inesperado.', 502);
            error.stage = 'response'; error.outcome_unknown = true;
            throw error;
        }
        return data;
    }

    async create(body) {
        const payload = validateGasto(this.organizationId, body);
        return GastoService.ensureGasto(await this.api.request('post', '/gastos', { data: payload, stage: 'create_gasto' }));
    }

    async get(id) {
        this.checkId(id);
        const data = await this.api.request('get', '/gastos/' + id, { stage: 'get_gasto' });
        if (!data || !Number.isInteger(data.id)) throw new GastoError('El servicio de Aptus devolvió un gasto con formato inesperado.', 502);
        return data;
    }

    async update(id, body) {
        this.checkId(id);
        const payload = validateGasto(this.organizationId, body, { update: true });
        return GastoService.ensureGasto(await this.api.request('patch', '/gastos/' + id, { data: payload, stage: 'update_gasto' }));
    }

    async remove(id) {
        this.checkId(id);
        return this.api.request('delete', '/gastos/' + id, { stage: 'delete_gasto' });
    }
}
