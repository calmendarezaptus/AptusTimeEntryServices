"use strict";
// Función del proyecto Tiempos (Catalyst). La usan la captura y el calendario de tiempos.
// Los tiempos van a ReportesSandbox (core/PrebillApiClient), que los respalda en Books por su cuenta.
// Lo único que esta función escribe en Books son las plantillas (cm_plantillas_time_entry).
import express from 'express';
import dotenv from 'dotenv';
import TiempoService from './services/TiempoService.js';
import TemplateService from './services/TemplateService.js';
import { registerCatalogRoutes } from './core/catalogs.js';
import { sendError } from './core/http.js';

dotenv.config();

const app = express();
app.use(express.json());

const tiempos = req => new TiempoService(req.params.organizationId, { req });

app.post('/:organizationId/tiempos', async (req, res) => {
    try { return res.status(201).json(await tiempos(req).create(req.body)); }
    catch (error) { return sendError(res, error, 'Error interno guardando el tiempo.'); }
});
app.get('/:organizationId/tiempos/:tiempoId', async (req, res) => {
    try { return res.json(await tiempos(req).get(req.params.tiempoId)); }
    catch (error) { return sendError(res, error, 'Error interno consultando el tiempo.'); }
});
app.patch('/:organizationId/tiempos/:tiempoId', async (req, res) => {
    try { return res.json(await tiempos(req).update(req.params.tiempoId, req.body)); }
    catch (error) { return sendError(res, error, 'Error interno actualizando el tiempo.'); }
});
app.delete('/:organizationId/tiempos/:tiempoId', async (req, res) => {
    try { return res.json(await tiempos(req).remove(req.params.tiempoId)); }
    catch (error) { return sendError(res, error, 'Error interno eliminando el tiempo.'); }
});

// Plantillas de captura (Books, cm_plantillas_time_entry). Siguen guardando IDs de Books.
app.get('/:organizationId/plantillas', async (req, res) => {
    try { return res.json(await new TemplateService(req.params.organizationId).list()); }
    catch (error) { return res.status(error.status || 502).json({ error: error.status ? error.message : 'No se pudieron cargar las plantillas.' }); }
});
app.post('/:organizationId/plantillas', async (req, res) => {
    try { return res.status(201).json(await new TemplateService(req.params.organizationId).create(req.body)); }
    catch (error) { return res.status(error.status || 502).json({ error: error.status ? error.message : 'No se pudo guardar la plantilla.', outcome_unknown: error.outcome_unknown || false }); }
});

// Lecturas de ReportesSandbox. Solo estos recursos; cualquier otro responde 404.
export const CATALOGS = {
    clientes: [],
    proyectos: [],
    abogados: [],
    'tareas-estandar': ['todos'],
    tiempos: ['proyecto_id', 'abogado_id', 'liberado', 'facturado', 'prebill_id', 'facturable', 'tarea_estandar_id', 'books_estado'],
};
registerCatalogRoutes(app, CATALOGS);

// Sin `stage` a propósito: un 404 con `stage` significa "el registro ya no existe".
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada en time_entry_services.' }));

export default app;
