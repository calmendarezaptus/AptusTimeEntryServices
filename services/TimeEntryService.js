import axios from 'axios';
import AuthService from '../core/AuthService.js';

export class TimeEntryError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}
const id = value => typeof value === 'string' && /^\d+$/.test(value);
const normalize = value => value.trim().normalize('NFC').toLocaleLowerCase('es');

export function validateTimeEntry(organizationId, body) {
    if (!id(organizationId)) throw new TimeEntryError('Organización inválida.');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TimeEntryError('Se requiere un objeto JSON.');
    for (const field of ['project_id', 'user_id']) {
        if (!id(body[field])) throw new TimeEntryError(field + ' debe ser un ID de Books en formato string.');
    }
    if (typeof body.task_name !== 'string' || !body.task_name.trim() || body.task_name.trim().length > 100) {
        throw new TimeEntryError('task_name debe contener el nombre del catálogo (máximo 100 caracteres).');
    }
    if (typeof body.log_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.log_date) ||
        !Number.isFinite(Date.parse(body.log_date)) || new Date(body.log_date).toISOString().slice(0, 10) !== body.log_date) {
        throw new TimeEntryError('log_date debe ser una fecha válida YYYY-MM-DD.');
    }
    if (typeof body.is_billable !== 'boolean') throw new TimeEntryError('is_billable debe ser booleano.');
    for (const field of ['notes', 'cf_referencia']) {
        if (body[field] !== undefined && typeof body[field] !== 'string') throw new TimeEntryError(field + ' debe ser texto.');
    }
    if ((body.notes?.length ?? 0) > 500) throw new TimeEntryError('Books admite como máximo 500 caracteres en notes.');
    const payload = { project_id: body.project_id, user_id: body.user_id, log_date: body.log_date, is_billable: body.is_billable };
    if (body.notes !== undefined) payload.notes = body.notes;
    if (body.start_timer !== undefined && typeof body.start_timer !== 'boolean') throw new TimeEntryError('start_timer debe ser booleano.');
    const duration = body.log_time !== undefined;
    const range = body.begin_time !== undefined || body.end_time !== undefined;
    const timer = body.start_timer === true;
    if (Number(duration) + Number(range) + Number(timer) !== 1) throw new TimeEntryError('Envía únicamente log_time, begin_time/end_time o start_timer: true.');
    if (duration) {
        if (typeof body.log_time !== 'string' || !/^\d{2}:[0-5]\d$/.test(body.log_time) || body.log_time === '00:00') throw new TimeEntryError('log_time debe ser HH:mm y mayor que cero.');
        payload.log_time = body.log_time;
    }
    if (range) {
        const clock = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
        if (!clock(body.begin_time) || !clock(body.end_time) || body.end_time <= body.begin_time) throw new TimeEntryError('Se requiere un rango HH:mm con fin posterior al inicio, en el mismo día.');
        payload.begin_time = body.begin_time; payload.end_time = body.end_time;
    }
    // Books documents start_timer as a string; our public contract remains boolean.
    if (timer) payload.start_timer = 'true';
    if (body.cf_referencia !== undefined) payload.timesheet_custom_fields = [{ api_name: 'cf_referencia', value: body.cf_referencia }];
    return { payload, taskName: body.task_name.trim() };
}

export default class TimeEntryService {
    constructor(organizationId, { http = axios, auth = new AuthService(organizationId) } = {}) {
        this.organizationId = organizationId; this.http = http; this.auth = auth;
    }
    async get(timeEntryId) {
        if (!id(this.organizationId) || !id(timeEntryId)) throw new TimeEntryError('Organización o ID de tiempo inválido.');
        try {
            const token = await this.auth.getAccessToken();
            if (!token) throw new Error('Token ausente.');
            const base = (process.env.ZOHO_BOOKS_API_BASE_URL || 'https://www.zohoapis.com/books/v3').replace(/\/$/, '');
            const { data } = await this.http.get(base + '/projects/timeentries/' + timeEntryId, { headers: { Authorization: 'Zoho-oauthtoken ' + token }, params: { organization_id: this.organizationId }, timeout: 30000 });
            if (data.code !== 0 || data.time_entry?.time_entry_id !== timeEntryId) throw new Error('Respuesta inválida.');
            return data.time_entry;
        } catch (cause) {
            throw new TimeEntryError(cause.response?.status === 404 ? 'No se encontró el tiempo en esta organización.' : 'No se pudo consultar el tiempo en Books.', cause.response?.status === 404 ? 404 : 502);
        }
    }
    async create(body, timeEntryId = null) {
        const { payload, taskName } = validateTimeEntry(this.organizationId, body);
        if (timeEntryId !== null && !id(timeEntryId)) throw new TimeEntryError('ID de tiempo inválido.');
        const original = timeEntryId ? await this.get(timeEntryId) : null;
        if (original && (body.start_timer || String(original.timer_started_at || '').trim() || String(original.timer_started_at_utc_time || '').trim())) throw new TimeEntryError('Detén el cronómetro en Books antes de editar este tiempo.', 409);
        let stage = 'authentication';
        let taskId = null;
        let taskCreated = false;
        try {
            const token = await this.auth.getAccessToken();
            if (!token) throw new Error('Token ausente.');
            const base = (process.env.ZOHO_BOOKS_API_BASE_URL || 'https://www.zohoapis.com/books/v3').replace(/\/$/, '');
            const options = { headers: { Authorization: 'Zoho-oauthtoken ' + token }, params: { organization_id: this.organizationId }, timeout: 30000 };
            const taskUrl = base + '/projects/' + payload.project_id + '/tasks';
            stage = 'list_tasks';
            const matches = new Map();
            if (original && original.project_id === payload.project_id && original.task_name === taskName) matches.set(original.task_id, original);
            for (let page = 1; matches.size === 0 || page > 1; page++) {
                const { data } = await this.http.get(taskUrl, { ...options, params: { ...options.params, page, per_page: 200 } });
                // Books returns the project task list under singular `task`.
                const tasks = data.task ?? data.tasks;
                if (data.code !== 0 || !Array.isArray(tasks)) throw new TimeEntryError('Books devolvió un listado de tareas con formato inesperado.', 502);
                for (const task of tasks) {
                    if (!id(task.task_id) || typeof task.task_name !== 'string') throw new Error('Tarea sin ID o nombre válido.');
                    if (normalize(task.task_name) === normalize(taskName)) matches.set(task.task_id, task);
                }
                if (data.page_context?.has_more_page !== true) break;
                if (!tasks.length || page >= 1000) throw new Error('Paginación de tareas inválida.');
            }
            if (matches.size > 1) throw new TimeEntryError('Hay varias tareas con ese nombre en el proyecto. Corrige el duplicado antes de guardar.', 409);
            if (matches.size === 1) {
                const task = [...matches.values()][0];
                if (task.status === 'inactive') throw new TimeEntryError('La tarea del proyecto está inactiva.', 409);
                taskId = task.task_id;
            } else {
                stage = 'create_task';
                const { data } = await this.http.post(taskUrl, { task_name: taskName }, options);
                if (data.code !== 0 || !id(data.task?.task_id)) throw new Error('Respuesta de creación de tarea inválida.');
                taskId = data.task.task_id; taskCreated = true;
            }
            stage = timeEntryId ? 'update_time_entry' : 'create_time_entry';
            if (original && Array.isArray(original.timesheet_custom_fields)) {
                payload.timesheet_custom_fields = [...original.timesheet_custom_fields.filter(f => f.api_name !== 'cf_referencia').map(f => ({ customfield_id: f.customfield_id, value: f.value })), ...(payload.timesheet_custom_fields || [])];
            }
            console.log('Enviando tiempo a Books', { project_id: payload.project_id, task_id: taskId });
            const { data } = await this.http[timeEntryId ? 'put' : 'post'](base + '/projects/timeentries' + (timeEntryId ? '/' + timeEntryId : ''), { ...payload, task_id: taskId }, options);
            if (data.code !== 0 || !id(data.time_entry?.time_entry_id)) throw new Error('Respuesta de creación de tiempo inválida.');
            return { task_id: taskId, task_created: taskCreated, time_entry: data.time_entry };
        } catch (cause) {
            // Never expose Axios config, headers, credentials, or provider response bodies.
            const error = cause instanceof TimeEntryError ? cause : new TimeEntryError('No se pudo completar el registro de tiempo en Zoho Books.', 502);
            error.stage = stage; error.task_id = taskId; error.task_created = taskCreated;
            error.provider_status = cause.response?.status ?? null;
            error.books_code = cause.response?.data?.code ?? null;
            error.outcome_unknown = ['create_task', 'create_time_entry', 'update_time_entry'].includes(stage) && !cause.response;
            throw error;
        }
    }
}
