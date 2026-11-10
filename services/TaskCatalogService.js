import axios from 'axios';
import AuthService from '../core/AuthService.js';

const MODULE_NAME = 'cm_cat_logo_de_tareas';

export default class TaskCatalogService {
    constructor(organizationId, { http = axios, auth = new AuthService(organizationId) } = {}) {
        this.organizationId = organizationId;
        this.http = http;
        this.auth = auth;
    }

    async getTasks() {
        const token = await this.auth.getAccessToken();
        if (!token) throw new Error('No se obtuvo el token de la organización.');
        const baseUrl = (process.env.ZOHO_BOOKS_API_BASE_URL || 'https://www.zohoapis.com/books/v3').replace(/\/$/, '');
        const tasks = [];
        let page = 1;
        let hasMore = true;
        while (hasMore) {
            const { data } = await this.http.get(`${baseUrl}/${MODULE_NAME}`, {
                headers: { Authorization: `Zoho-oauthtoken ${token}` },
                params: { organization_id: this.organizationId, page, per_page: 200 },
                timeout: 30000
            });
            // Books returns module_records; older documented responses use module_record.
            const records = data.module_records ?? data.module_record;
            if (data.code !== 0 || !Array.isArray(records)) {
                throw new Error('Respuesta inválida al consultar el catálogo de tareas.');
            }
            for (const record of records) {
                if (!record.module_record_id || typeof record.cf_nombre !== 'string' || !record.cf_nombre.trim()) {
                    throw new Error('El catálogo contiene una tarea sin ID o nombre.');
                }
                tasks.push({
                    // This is a catalog record ID, not a Books project task ID.
                    id: String(record.module_record_id),
                    cf_nombre: record.cf_nombre,
                    cf_nombre_ingl_s: record.cf_nombre_ingl_s ?? ''
                });
            }
            hasMore = data.page_context?.has_more_page === true;
            if (hasMore && records.length === 0) {
                throw new Error('Paginación inválida del catálogo de tareas.');
            }
            page += 1;
        }
        return tasks;
    }
}
