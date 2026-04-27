"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSync = runSync;
const supabase_js_1 = require("../lib/supabase.js");
const ghl_js_1 = require("./ghl.js");
// =============================================================================
// Servicio de Sincronización GHL → Supabase
// =============================================================================
// Ejecutado por el cron job (jobs/syncJob.ts) y por POST /api/sync (admin).
// Usa service role para bypasear RLS en los upserts.
// =============================================================================
// ── Mapeo de stage ────────────────────────────────────────────────────────────
/**
 * Convierte el nombre de un stage de GHL al enum interno de la tabla leads.
 * GHL permite nombres de stage personalizados — este mapeo es aproximado.
 * Ajustar según los stage names reales del account de Diana en GHL.
 */
function mapGHLStageToLeadStage(stageName, status) {
    if (status === 'won')
        return 'won';
    if (status === 'lost' || status === 'abandoned')
        return 'lost';
    const lower = stageName.toLowerCase();
    if (/nuevo|new|lead|prospect/.test(lower))
        return 'new';
    if (/contact|llamad|reach|tocado/.test(lower))
        return 'contacted';
    if (/calific|qualif|interés|interest/.test(lower))
        return 'qualified';
    if (/propuesta|proposal|cotiz|quote/.test(lower))
        return 'proposal';
    if (/negoc|closing|cierre/.test(lower))
        return 'negotiation';
    return 'new';
}
/**
 * Mapea el status de GHL (open/won/lost/abandoned) al enum interno.
 * 'abandoned' se trata como 'lost'.
 */
function mapGHLStatus(status) {
    if (status === 'won')
        return 'won';
    if (status === 'lost' || status === 'abandoned')
        return 'lost';
    return 'open';
}
/**
 * Ejecuta la sincronización completa:
 * 1. Descarga todos los contactos de GHL → upsert en `leads`
 * 2. Descarga todas las oportunidades de GHL → upsert en `opportunities`
 *    y actualiza el stage del lead correspondiente
 *
 * Es idempotente: correr múltiples veces no crea duplicados
 * (usa ON CONFLICT DO UPDATE via upsert de Supabase).
 */
async function runSync() {
    const started_at = new Date().toISOString();
    const errors = [];
    let leads_upserted = 0;
    let opportunities_upserted = 0;
    console.log('[Sync] Iniciando sincronización con GHL…');
    // ── Paso 1: Oportunidades (primero para tener el stage de cada contacto) ──
    let ghlOpportunities = [];
    try {
        ghlOpportunities = await (0, ghl_js_1.fetchAllOpportunities)();
        console.log(`[Sync] ${ghlOpportunities.length} oportunidades descargadas de GHL`);
    }
    catch (err) {
        errors.push(`fetchAllOpportunities: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Mapa contactId → stage derivado de la oportunidad más reciente
    const contactStageMap = new Map();
    for (const opp of ghlOpportunities) {
        if (!opp.contact?.id)
            continue;
        const stage = mapGHLStageToLeadStage(opp.pipelineStage?.name ?? '', opp.status);
        // Solo sobreescribir si el nuevo stage es "más avanzado"
        const stageOrder = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
        const existing = contactStageMap.get(opp.contact.id);
        if (!existing || stageOrder.indexOf(stage) > stageOrder.indexOf(existing)) {
            contactStageMap.set(opp.contact.id, stage);
        }
    }
    // ── Paso 2: Contactos → leads ─────────────────────────────────────────────
    let ghlContacts = [];
    try {
        ghlContacts = await (0, ghl_js_1.fetchAllContacts)();
        console.log(`[Sync] ${ghlContacts.length} contactos descargados de GHL`);
    }
    catch (err) {
        errors.push(`fetchAllContacts: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (ghlContacts.length > 0) {
        const leadsPayload = ghlContacts.map((c) => ({
            ghl_contact_id: c.id,
            name: c.name || 'Sin nombre',
            email: c.email || null,
            phone: c.phone || null,
            source: c.source || null,
            stage: contactStageMap.get(c.id) ?? 'new',
            updated_at: new Date().toISOString(),
        }));
        // Upsert en lotes de 500 para evitar límites de payload
        for (let i = 0; i < leadsPayload.length; i += 500) {
            const batch = leadsPayload.slice(i, i + 500);
            const { error } = await supabase_js_1.supabaseAdmin
                .from('leads')
                .upsert(batch, { onConflict: 'ghl_contact_id' });
            if (error) {
                errors.push(`leads upsert batch ${i}: ${error.message}`);
            }
            else {
                leads_upserted += batch.length;
            }
        }
        console.log(`[Sync] ${leads_upserted} leads upserted`);
    }
    // ── Paso 3: Oportunidades → opportunities ─────────────────────────────────
    // Necesitamos el uuid interno de cada lead para el campo lead_id.
    if (ghlOpportunities.length > 0) {
        // Fetch del mapa ghl_contact_id → uuid interno de leads
        const contactIds = [...new Set(ghlOpportunities.filter((o) => o.contact?.id).map((o) => o.contact.id))];
        const { data: leadsData, error: leadsErr } = await supabase_js_1.supabaseAdmin
            .from('leads')
            .select('id, ghl_contact_id')
            .in('ghl_contact_id', contactIds);
        if (leadsErr) {
            errors.push(`leads lookup: ${leadsErr.message}`);
        }
        const leadIdMap = new Map((leadsData ?? []).map((l) => [l.ghl_contact_id, l.id]));
        const oppsPayload = ghlOpportunities
            .filter((o) => o.contact?.id && leadIdMap.has(o.contact.id))
            .map((o) => ({
            ghl_opportunity_id: o.id,
            lead_id: leadIdMap.get(o.contact.id),
            pipeline_id: o.pipelineId,
            stage_name: o.pipelineStage?.name ?? o.pipelineStageId,
            value: o.monetaryValue ?? 0,
            status: mapGHLStatus(o.status),
        }));
        for (let i = 0; i < oppsPayload.length; i += 500) {
            const batch = oppsPayload.slice(i, i + 500);
            const { error } = await supabase_js_1.supabaseAdmin
                .from('opportunities')
                .upsert(batch, { onConflict: 'ghl_opportunity_id' });
            if (error) {
                errors.push(`opportunities upsert batch ${i}: ${error.message}`);
            }
            else {
                opportunities_upserted += batch.length;
            }
        }
        console.log(`[Sync] ${opportunities_upserted} oportunidades upserted`);
    }
    const finished_at = new Date().toISOString();
    console.log(`[Sync] Finalizado. Errores: ${errors.length}`);
    return { leads_upserted, opportunities_upserted, errors, started_at, finished_at };
}
