# Guardar tiempo

POST /:organizationId/tiempos
Content-Type: application/json

Ejemplo (reemplazar los IDs por IDs reales de Books):

~~~json
{
  "project_id": "123456789",
  "user_id": "987654321",
  "task_name": "Estándar",
  "log_date": "2026-10-11",
  "log_time": "01:30",
  "is_billable": true,
  "notes": "Descripción de la actividad",
  "cf_referencia": "Referencia del trabajo"
}
~~~

- project_id: zoho_id del proyecto seleccionado, nunca su ID local de Mirror DB.
- user_id: ID del usuario/abogado en Books, como string.
- task_name: cf_nombre del catálogo global. El ID del catálogo no es un task_id de proyecto. cf_nombre_ingl_s permanece en la interfaz para uso posterior.
- log_date: YYYY-MM-DD válido.
- log_time: duración HH:mm; 01:30 representa una hora y media. No enviar horas decimales como 1.55.
- Alternativamente, omitir log_time y enviar begin_time/end_time (HH:mm, mismo día, fin posterior al inicio), o start_timer: true.
- is_billable: booleano obligatorio. Cada petición crea un tiempo para un usuario y una clasificación facturable. La futura integración de varios abogados o tiempos mixtos debe enviar entradas separadas y gestionar éxitos parciales.
- notes: opcional, máximo 500 caracteres según la documentación de Books; se rechaza el exceso sin truncarlo.
- cf_referencia: opcional. Se prepara en timesheet_custom_fields con api_name cf_referencia y value. La documentación pública no especifica su formato de escritura; queda pendiente verificar su persistencia en la primera prueba real. La lectura de un tiempo existente confirmó timesheet_custom_fields, pero estaba vacío.
- Cliente, plantilla y propiedades adicionales no se reenvían a Books.

## Flujo

Se validan los datos antes de autenticar o escribir. AuthService obtiene el token usando la organización. Se consultan todas las páginas de /projects/{project_id}/tasks. La comparación ignora mayúsculas y espacios exteriores, conserva acentos y normaliza Unicode NFC. Si existe una coincidencia se reutiliza su task_id; varias coincidencias o una tarea inactiva producen 409. Si no existe, se crea con task_name. Finalmente se llama a POST /projects/timeentries.

Éxito HTTP 201: { task_id, task_created, time_entry }.
Errores: 400 validación, 409 conflicto de tarea, 502 fallo del proveedor. Incluyen stage, task_id, task_created y outcome_unknown para distinguir el paso fallido. No se exponen credenciales ni el cuerpo de errores del proveedor.

No hay reintentos automáticos de escrituras. Si una escritura expira sin respuesta, outcome_unknown será true: consultar Books antes de reintentar para evitar duplicar el tiempo. Una tarea creada permanece si falla el tiempo. La secuencia no es una transacción y no garantiza exclusión entre peticiones concurrentes; la interfaz deberá impedir envíos dobles. Para varios servidores/reintentos automáticos será necesaria idempotencia persistente.

## Verificación

npm test (mocks, sin escrituras reales en Books).
No se ha desplegado ni conectado el botón Guardar de la interfaz. Pendiente prueba de integración real, incluidos referencia y cronómetro.

Referencias oficiales:
- https://www.zoho.com/books/api/v3/projects/
- https://www.zoho.com/books/api/v3/time-entries/

## Edición
GET /:organizationId/tiempos/:timeEntryId devuelve { time_entry } desde Books. PUT en esa misma ruta actualiza el registro existente; reutiliza su tarea cuando no cambia proyecto/nombre. No inicia cronómetros durante edición. La interfaz usa ?organization_id=...&time_entry_id=... y requiere que cliente/proyecto/abogado existan en sus catálogos. Las tareas históricas fuera del catálogo global se conservan como opción.

## Plantillas
GET /:organizationId/plantillas lista todas las páginas de cm_plantillas_time_entry. POST en la misma ruta crea una plantilla con los campos cf_clave, cf_cliente, cf_proyecto, cf_abogado, cf_tarea, cf_registrar_como, cf_horas_facturables, cf_no_facturables, cf_reference_number. Los lookups usan IDs de Books; cf_tarea usa el ID del catálogo global.
La interfaz pide Clave y crea la plantilla una vez al terminar todos los tiempos. Si falla, conserva los IDs ya guardados y reintenta únicamente la plantilla en esa sesión; una respuesta incierta bloquea reenvíos hasta revisión. Recargar pierde esa cola local. No hay transacción entre servicios. Fecha, descripción, cronómetro y múltiples abogados no se almacenan en el módulo actual; Inicia y Termina requiere capturar horas nuevamente al aplicar.
