import axios from 'axios';
import AuthService from '../core/AuthService.js';
const MODULE = 'cm_plantillas_time_entry';
const fields = ['cf_clave','cf_cliente','cf_proyecto','cf_abogado','cf_tarea','cf_registrar_como','cf_horas_facturables','cf_no_facturables','cf_reference_number'];
export class TemplateError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export function normalizeTemplate(record) {
    if (!record?.module_record_id || typeof record.cf_clave !== 'string') throw new TemplateError('Respuesta de plantillas inválida.',502);
    return {id:String(record.module_record_id),...Object.fromEntries(fields.map(key=>[key,record[key] == null ? '' : String(record[key])]))};
}
export function validateTemplate(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TemplateError('Plantilla inválida.');
    const result={};
    for (const key of fields) {
        const value=body[key] ?? '';
        if(typeof value!=='string') throw new TemplateError('Campo de plantilla inválido: '+key);
        result[key]=value.trim();
    }
    if(!result.cf_clave || result.cf_clave.length>255) throw new TemplateError('Captura la clave de la plantilla (máximo 255 caracteres).');
    for(const key of ['cf_cliente','cf_proyecto','cf_abogado','cf_tarea']) if(result[key] && !/^\d+$/.test(result[key])) throw new TemplateError('La plantilla requiere IDs de Books válidos.');
    if(!['Horas','Inicia y Termina'].includes(result.cf_registrar_como)) throw new TemplateError('Modo de plantilla no admitido por el módulo.');
    for(const key of ['cf_horas_facturables','cf_no_facturables']) if(!/^\d+(\.\d{1,2})?$/.test(result[key]) || Number(result[key])>99) throw new TemplateError('Horas de plantilla inválidas.');
    if(result.cf_reference_number.length>255) throw new TemplateError('La referencia de plantilla admite 255 caracteres.');
    return result;
}
export default class TemplateService {
    constructor(organizationId,{http=axios,auth=new AuthService(organizationId)}={}){this.organizationId=organizationId;this.http=http;this.auth=auth;}
    async connection(){
        if(!/^\d+$/.test(this.organizationId)) throw new TemplateError('Organización inválida.');
        const token=await this.auth.getAccessToken();if(!token) throw new TemplateError('No se obtuvo acceso a Books.',502);
        return {url:(process.env.ZOHO_BOOKS_API_BASE_URL||'https://www.zohoapis.com/books/v3').replace(/\/$/,'')+'/'+MODULE,options:{headers:{Authorization:'Zoho-oauthtoken '+token},params:{organization_id:this.organizationId},timeout:30000}};
    }
    async list(){
        const {url,options}=await this.connection(); const result=[];
        for(let page=1;;page++){
            const {data}=await this.http.get(url,{...options,params:{...options.params,page,per_page:200}});
            const rows=data.module_records??data.module_record;
            if(data.code!==0||!Array.isArray(rows))throw new TemplateError('No se pudo interpretar el catálogo de plantillas.',502);
            result.push(...rows.map(normalizeTemplate));
            if(data.page_context?.has_more_page!==true)break;
            if(!rows.length||page>=1000)throw new TemplateError('Paginación de plantillas inválida.',502);
        }
        return result;
    }
    async create(body){
        const payload=validateTemplate(body);const {url,options}=await this.connection();
        try {
            const {data}=await this.http.post(url,payload,options);
            const raw = data.module_record_hash || (Array.isArray(data.module_record) && data.module_record.length === 1 ? data.module_record[0] : data.module_record);
            const record = raw && !Array.isArray(raw) ? {...raw,...Object.fromEntries((raw.module_fields||[]).map(f=>[f.api_name,f.value]))} : null;
            if(data.code!==0||!record?.module_record_id)throw new Error('Respuesta no confirmada.');
            return normalizeTemplate({...payload,...record});
        }catch(cause){const error=new TemplateError('No se pudo confirmar el guardado de la plantilla.',502);error.outcome_unknown=!cause.response;throw error;}
    }
}
