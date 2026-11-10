import TemplateService from './services/TemplateService.js';
"use strict";

import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

import TimeEntryService from './services/TimeEntryService.js';

import TaskCatalogService from './services/TaskCatalogService.js';

import GastoService from './services/GastoService.js';
import { sendError } from './core/http.js';
import { registerCatalogRoutes } from './core/catalogs.js';
import cors from 'cors';

const app = express();


// app.use((req, res, next) => {
//     console.log("[CORS DEBUG]", {
//         method: req.method,
//         url: req.originalUrl,
//         origin: req.headers.origin
//     });

//     next();
// });


// app.use((req, res, next) => {
//     console.log("REQUEST:", req.method, req.originalUrl);
//     next();
// });

// app.use(cors({
//     origin: "*",
//     methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
// }));

// app.get("/cors-test", (req, res) => {
//     res.json({ success: true });
// });
app.use(express.json());


// Resolve the catalog task inside the Books project before recording time.
app.post('/:organizationId/tiempos', async (req, res) => {
    console.log('Inicia proceso post');
    console.log(req.body);
    try {
        const result = await new TimeEntryService(req.params.organizationId).create(req.body);
        return res.status(201).json(result);
    } catch (error) {
        const status = error.status || 500;
        const details = {
            stage: error.stage ?? 'validation',
            task_id: error.task_id ?? null,
            task_created: error.task_created ?? false,
            outcome_unknown: error.outcome_unknown ?? false
        };
        if (status >= 500) console.error('Error guardando tiempo', { ...details, provider_status: error.provider_status ?? null, books_code: error.books_code ?? null });
        return res.status(status).json({ error: status === 500 ? 'Error interno guardando tiempo.' : error.message, ...details });
    }
});

app.get('/:organizationId/tiempos/:timeEntryId', async (req, res) => {
    try { return res.json({ time_entry: await new TimeEntryService(req.params.organizationId).get(req.params.timeEntryId) }); }
    catch (error) { return res.status(error.status || 502).json({ error: error.message, stage: 'get_time_entry' }); }
});
app.put('/:organizationId/tiempos/:timeEntryId', async (req, res) => {
    try { return res.json(await new TimeEntryService(req.params.organizationId).create(req.body, req.params.timeEntryId)); }
    catch (error) { return res.status(error.status || 502).json({ error: error.message, stage: error.stage || 'validation', outcome_unknown: error.outcome_unknown || false, task_id: error.task_id || null, task_created: error.task_created || false }); }
});

app.get('/:organizationId/plantillas', async (req, res) => {
    try { return res.json(await new TemplateService(req.params.organizationId).list()); }
    catch (error) { return res.status(error.status || 502).json({ error: error.status ? error.message : 'No se pudieron cargar las plantillas.' }); }
});
app.post('/:organizationId/plantillas', async (req, res) => {
    try { return res.status(201).json(await new TemplateService(req.params.organizationId).create(req.body)); }
    catch (error) { return res.status(error.status || 502).json({ error: error.status ? error.message : 'No se pudo guardar la plantilla.', outcome_unknown: error.outcome_unknown || false }); }
});

// TRANSITORIO: gastos ya vive en expense_services (proyecto Gastos). Estas rutas se quitan cuando
// la captura y el calendario de gastos apunten a la función nueva y se confirme que funciona.
// El listado GET /:organizationId/gastos sigue en la ruta genérica.
app.post('/:organizationId/gastos', async (req, res) => {
    try { return res.status(201).json(await new GastoService(req.params.organizationId, { req }).create(req.body)); }
    catch (error) { return sendError(res, error, 'Error interno guardando el gasto.'); }
});
app.get('/:organizationId/gastos/:gastoId', async (req, res) => {
    try { return res.json(await new GastoService(req.params.organizationId, { req }).get(req.params.gastoId)); }
    catch (error) { return sendError(res, error, 'Error interno consultando el gasto.'); }
});
app.patch('/:organizationId/gastos/:gastoId', async (req, res) => {
    try { return res.json(await new GastoService(req.params.organizationId, { req }).update(req.params.gastoId, req.body)); }
    catch (error) { return sendError(res, error, 'Error interno actualizando el gasto.'); }
});
app.delete('/:organizationId/gastos/:gastoId', async (req, res) => {
    try { return res.json(await new GastoService(req.params.organizationId, { req }).remove(req.params.gastoId)); }
    catch (error) { return sendError(res, error, 'Error interno eliminando el gasto.'); }
});

// This route must precede the generic Mirror DB catalog route.
app.get('/:organizationId/tareas', async (req, res) => {
    const { organizationId } = req.params;
    if (!/^\d+$/.test(organizationId)) {
        return res.status(400).json({ error: 'Organización inválida.' });
    }
    try {
        const tasks = await new TaskCatalogService(organizationId).getTasks();
        return res.json(tasks);
    } catch (error) {
        // Do not log Axios errors: they can contain authorization headers.
        console.error('Error consultando tareas', {
            organizationId,
            status: error.response?.status ?? null,
            code: error.code ?? null,
            booksCode: error.response?.data?.code ?? null,
            message: error.isAxiosError ? 'Fallo en la consulta HTTP al proveedor.' : error.message
        });
        return res.status(502).json({ error: 'No se pudo obtener el catálogo de tareas de Zoho Books. Intenta nuevamente.' });
    }
});
// Lecturas de ReportesSandbox (antes: ruta genérica que reenviaba cualquier GET). Solo estos
// recursos; cualquier otro responde 404. Debe ir al final: atrapa GET /:org/<recurso>.
export const CATALOGS = {
    clientes: [],
    proyectos: [],
    abogados: [],
    tiempos: [],
    // TRANSITORIO (gastos vive en expense_services):
    gastos: [],
    'categorias-gasto': ['todos'],
};
registerCatalogRoutes(app, CATALOGS);

// Sin `stage` a propósito: un 404 con `stage` significa "el registro ya no existe".
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada en time_entry_services.' }));

export default app;
