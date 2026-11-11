import PrebillApiClient from '../core/PrebillApiClient.js';

// Tiempos en ReportesSandbox (POST/GET/PATCH/DELETE /tiempos). La API guarda el tiempo con su tarifa
// y ella misma lo respalda en Books (crea la tarea, asigna al usuario y reintenta cada noche); borrar
// también lo quita de Books. Esta función ya no escribe tiempos directo en Books.
export class TiempoError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

const orgId = value => typeof value === 'string' && /^\d+$/.test(value);
const localId = value => Number.isInteger(value) && value > 0;
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export const DESCRIPCION_MAX = 500; // límite de la nota del time entry en Books
const TAREA_MAX = 100;

// Alta: abogado, proyecto, fecha, horas, facturable y una tarea (estándar o texto libre).
// Edición: sin abogado ni proyecto (la API no permite cambiarlos).
export function validateTiempo(organizationId, body, { update = false } = {}) {
    if (!orgId(organizationId)) throw new TiempoError('Organización inválida.');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TiempoError('Se requiere un objeto JSON.');
    const payload = {};
    if (!update) {
        if (!localId(body.abogado_id)) throw new TiempoError('abogado_id debe ser el ID del abogado en Aptus (entero).');
        if (!localId(body.proyecto_id)) throw new TiempoError('proyecto_id debe ser el ID del proyecto en Aptus (entero).');
        payload.abogado_id = body.abogado_id;
        payload.proyecto_id = body.proyecto_id;
    }
    if (!isDate(body.fecha)) throw new TiempoError('fecha debe ser una fecha válida YYYY-MM-DD.');
    payload.fecha = body.fecha;
    if (typeof body.horas !== 'number' || !Number.isFinite(body.horas) || body.horas <= 0) throw new TiempoError('horas debe ser un número mayor que 0.');
    if (body.horas > 24) throw new TiempoError('Un registro no puede pasar de 24 horas.');
    if (Math.round(body.horas * 100) !== body.horas * 100) throw new TiempoError('horas admite como máximo 2 decimales.');
    payload.horas = body.horas;
    if (body.descripcion !== undefined) {
        if (typeof body.descripcion !== 'string') throw new TiempoError('descripcion debe ser texto.');
        if (body.descripcion.length > DESCRIPCION_MAX) throw new TiempoError(`La descripción admite hasta ${DESCRIPCION_MAX} caracteres (es la nota del tiempo en Books).`);
        payload.descripcion = body.descripcion;
    }
    const hasStandard = body.tarea_estandar_id !== undefined && body.tarea_estandar_id !== null;
    const hasText = body.tarea !== undefined && body.tarea !== null;
    if (hasStandard === hasText) throw new TiempoError('Indica una tarea: tarea_estandar_id o tarea (texto), solo una.');
    if (hasStandard) {
        if (!localId(body.tarea_estandar_id)) throw new TiempoError('tarea_estandar_id debe ser un entero.');
        payload.tarea_estandar_id = body.tarea_estandar_id;
    } else {
        if (typeof body.tarea !== 'string' || !body.tarea.trim() || body.tarea.trim().length > TAREA_MAX) throw new TiempoError(`tarea debe ser texto de 1 a ${TAREA_MAX} caracteres.`);
        payload.tarea = body.tarea.trim();
    }
    if (typeof body.facturable !== 'boolean') throw new TiempoError('facturable debe ser booleano.');
    payload.facturable = body.facturable ? 1 : 0;
    return payload;
}

export default class TiempoService {
    constructor(organizationId, { api = null, req = null } = {}) {
        this.organizationId = organizationId;
        this.api = api ?? new PrebillApiClient(organizationId, { req });
    }

    checkId(id) {
        if (!orgId(this.organizationId)) throw new TiempoError('Organización inválida.');
        if (typeof id !== 'string' || !/^\d+$/.test(id)) throw new TiempoError('ID de tiempo inválido.');
    }

    static ensureTiempo(data) {
        if (!data || !Number.isInteger(data.id)) {
            const error = new TiempoError('El servicio de Aptus devolvió un tiempo con formato inesperado.', 502);
            error.stage = 'response'; error.outcome_unknown = true;
            throw error;
        }
        return data;
    }

    async create(body) {
        const payload = validateTiempo(this.organizationId, body);
        return TiempoService.ensureTiempo(await this.api.request('post', '/tiempos', { data: payload, stage: 'create_tiempo' }));
    }

    async get(id) {
        this.checkId(id);
        const data = await this.api.request('get', '/tiempos/' + id, { stage: 'get_tiempo' });
        if (!data || !Number.isInteger(data.id)) throw new TiempoError('El servicio de Aptus devolvió un tiempo con formato inesperado.', 502);
        return data;
    }

    async update(id, body) {
        this.checkId(id);
        const payload = validateTiempo(this.organizationId, body, { update: true });
        return TiempoService.ensureTiempo(await this.api.request('patch', '/tiempos/' + id, { data: payload, stage: 'update_tiempo' }));
    }

    async remove(id) {
        this.checkId(id);
        return this.api.request('delete', '/tiempos/' + id, { stage: 'delete_tiempo' });
    }
}
