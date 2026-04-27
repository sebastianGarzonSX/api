"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSync = runSync;
const supabase_js_1 = require("../lib/supabase.js");
const ghl_js_1 = require("./ghl.js");
const meta_js_1 = require("./meta.js");
// =============================================================================
// Servicio de Sincronización GHL + Meta → Supabase
// =============================================================================
// Ejecutado por el cron job (jobs/syncJob.ts) y por POST /api/sync (admin).
// Usa service role para bypasear RLS en los upserts.
//
// Sync de contactos: INCREMENTAL por defecto — solo trae contactos creados
//   después del último sync exitoso. Pasar force=true para resync completo.
// Sync de oportunidades: siempre completo (stages cambian, son ~2400).
// Sync de Meta: últimos 30 días (o 90 días en sync forzado).
// =============================================================================
// ── Mapeo de stage ────────────────────────────────────────────────────────────
function buildContactName(c) {
    if (c.contactName)
        return c.contactName;
    const full = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
    return full || 'Sin nombre';
}
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
function mapGHLStatus(status) {
    if (status === 'won')
        return 'won';
    if (status === 'lost' || status === 'abandoned')
        return 'lost';
    return 'open';
}
// ── Helpers de sync_state ─────────────────────────────────────────────────────
async function getSyncState(key) {
    const { data } = await supabase_js_1.supabaseAdmin
        .from('sync_state')
        .select('value')
        .eq('key', key)
        .maybeSingle();
    return data?.value ?? null;
}
async function setSyncState(key, value) {
    await supabase_js_1.supabaseAdmin
        .from('sync_state')
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}
// ── Sync principal ────────────────────────────────────────────────────────────
/**
 * @param force  Si es true, ignora el estado incremental y descarga todo desde GHL.
 *               Útil cuando se sospecha que hay datos corruptos o cuando se cambia
 *               la API Key de GHL.
 */
async function runSync(force = false) {
    const started_at = new Date().toISOString();
    const errors = [];
    let leads_upserted = 0;
    let opportunities_upserted = 0;
    let pipelines_upserted = 0;
    let meta_records_upserted = 0;
    console.log(`[Sync] Iniciando sincronización${force ? ' COMPLETA (force)' : ' incremental'}…`);
    // ── Paso 0: Pipelines (caché de nombres y stages) ─────────────────────────
    // Siempre sincronizar — son pocos y necesitamos los nombres para el join.
    let ghlPipelines = [];
    try {
        ghlPipelines = await (0, ghl_js_1.fetchAllPipelines)();
        const pipelinesPayload = ghlPipelines.map((p) => ({
            id: p.id,
            name: p.name,
            location_id: p.locationId,
            synced_at: new Date().toISOString(),
        }));
        const { error: pErr } = await supabase_js_1.supabaseAdmin
            .from('pipelines')
            .upsert(pipelinesPayload, { onConflict: 'id' });
        if (pErr) {
            errors.push(`pipelines upsert: ${pErr.message}`);
        }
        else {
            pipelines_upserted = pipelinesPayload.length;
        }
        // Upsert stages
        const stagesPayload = ghlPipelines.flatMap((p) => p.stages.map((s) => ({
            id: s.id,
            pipeline_id: p.id,
            name: s.name,
            position: s.position,
            win_probability: s.stageWinProbability ?? 0,
        })));
        if (stagesPayload.length > 0) {
            const { error: sErr } = await supabase_js_1.supabaseAdmin
                .from('pipeline_stages')
                .upsert(stagesPayload, { onConflict: 'id' });
            if (sErr)
                errors.push(`pipeline_stages upsert: ${sErr.message}`);
        }
        console.log(`[Sync] ${pipelines_upserted} pipelines upserted`);
    }
    catch (err) {
        errors.push(`fetchAllPipelines: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Construir mapa pipelineId → name para enriquecer oportunidades
    const pipelineNameMap = new Map(ghlPipelines.map((p) => [p.id, p.name]));
    // Mapa stageId → stageName — fix para cuando GHL retorna el ID en lugar del nombre
    const stageNameMap = new Map(ghlPipelines.flatMap((p) => p.stages.map((s) => [s.id, s.name])));
    // ── Determinar punto de inicio para contactos ──────────────────────────────
    let sinceEpochMs;
    let incremental_contacts = false;
    if (!force) {
        const lastSync = await getSyncState('last_contacts_sync_at');
        if (lastSync) {
            sinceEpochMs = new Date(lastSync).getTime();
            incremental_contacts = true;
            console.log(`[Sync] Modo incremental — contactos desde ${lastSync}`);
        }
    }
    // ── Paso 1: Oportunidades (siempre completo — stages cambian) ──────────────
    let ghlOpportunities = [];
    try {
        ghlOpportunities = await (0, ghl_js_1.fetchAllOpportunities)();
        console.log(`[Sync] ${ghlOpportunities.length} oportunidades descargadas de GHL`);
    }
    catch (err) {
        errors.push(`fetchAllOpportunities: ${err instanceof Error ? err.message : String(err)}`);
    }
    const contactStageMap = new Map();
    const stageOrder = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
    for (const opp of ghlOpportunities) {
        if (!opp.contact?.id)
            continue;
        const stage = mapGHLStageToLeadStage(opp.pipelineStage?.name ?? '', opp.status);
        const existing = contactStageMap.get(opp.contact.id);
        if (!existing || stageOrder.indexOf(stage) > stageOrder.indexOf(existing)) {
            contactStageMap.set(opp.contact.id, stage);
        }
    }
    // ── Paso 2: Contactos → leads ──────────────────────────────────────────────
    let ghlContacts = [];
    try {
        ghlContacts = await (0, ghl_js_1.fetchAllContacts)(sinceEpochMs);
        console.log(`[Sync] ${ghlContacts.length} contactos descargados de GHL`);
    }
    catch (err) {
        errors.push(`fetchAllContacts: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (ghlContacts.length > 0) {
        const uniqueContacts = new Map();
        for (const c of ghlContacts) {
            uniqueContacts.set(c.id, c);
        }
        console.log(`[Sync] Contactos únicos: ${uniqueContacts.size}`);
        const leadsPayload = [...uniqueContacts.values()].map((c) => {
            // Atribución del primer toque (isFirst=true); si no hay, tomar el primero
            const firstAttr = c.attributions?.find((a) => a.isFirst) ?? c.attributions?.[0];
            return {
                ghl_contact_id: c.id,
                name: buildContactName(c),
                email: c.email || null,
                phone: c.phone || null,
                source: c.source || null,
                stage: contactStageMap.get(c.id) ?? 'new',
                ghl_date_added: c.dateAdded ?? null,
                tags: c.tags ?? [],
                attribution_ad_id: firstAttr?.utmAdId ?? null,
                attribution_ad_name: firstAttr?.adName ?? null,
                attribution_utm_source: firstAttr?.utmSessionSource ?? null,
                attribution_medium: firstAttr?.medium ?? null,
                attribution_page_url: firstAttr?.pageUrl ?? null,
                updated_at: new Date().toISOString(),
            };
        });
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
    else if (incremental_contacts) {
        console.log('[Sync] Sin contactos nuevos desde el último sync.');
    }
    // ── Paso 3: Oportunidades → opportunities ─────────────────────────────────
    if (ghlOpportunities.length > 0) {
        const contactIds = [...new Set(ghlOpportunities.filter((o) => o.contact?.id).map((o) => o.contact.id))];
        const leadIdMap = new Map();
        for (let i = 0; i < contactIds.length; i += 200) {
            const chunk = contactIds.slice(i, i + 200);
            const { data: leadsData, error: leadsErr } = await supabase_js_1.supabaseAdmin
                .from('leads')
                .select('id, ghl_contact_id')
                .in('ghl_contact_id', chunk);
            if (leadsErr) {
                errors.push(`leads lookup batch ${i}: ${leadsErr.message}`);
            }
            else {
                for (const l of leadsData ?? []) {
                    leadIdMap.set(l.ghl_contact_id, l.id);
                }
            }
        }
        console.log(`[Sync] Lead ID map: ${leadIdMap.size} entradas`);
        const uniqueOpps = new Map();
        for (const o of ghlOpportunities) {
            uniqueOpps.set(o.id, o);
        }
        const oppsPayload = [...uniqueOpps.values()]
            .filter((o) => o.contact?.id && leadIdMap.has(o.contact.id))
            .map((o) => ({
            ghl_opportunity_id: o.id,
            lead_id: leadIdMap.get(o.contact.id),
            pipeline_id: o.pipelineId,
            pipeline_name: pipelineNameMap.get(o.pipelineId) ?? null,
            stage_name: o.pipelineStage?.name
                ?? stageNameMap.get(o.pipelineStageId)
                ?? o.pipelineStageId,
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
    // ── Paso 4: Meta Ads ───────────────────────────────────────────────────────
    if (process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID) {
        try {
            const now = new Date();
            const until = now.toISOString().slice(0, 10);
            // En sync forzado trae 90 días; incremental trae solo los últimos 30
            const sinceDays = force ? 90 : 30;
            const sinceDate = new Date(now.getTime() - sinceDays * 86_400_000)
                .toISOString().slice(0, 10);
            // ── Campaña (para el summary bar de Meta) ──────────────────────────
            const insights = await (0, meta_js_1.fetchCampaignInsights)(sinceDate, until);
            console.log(`[Sync] ${insights.length} registros de Meta (campaign) obtenidos`);
            for (let i = 0; i < insights.length; i += 500) {
                const batch = insights.slice(i, i + 500).map((r) => ({
                    ...r,
                    synced_at: new Date().toISOString(),
                }));
                const { error } = await supabase_js_1.supabaseAdmin
                    .from('meta_campaigns')
                    .upsert(batch, { onConflict: 'campaign_id,date_start,date_stop' });
                if (error) {
                    errors.push(`meta campaign upsert batch ${i}: ${error.message}`);
                }
                else {
                    meta_records_upserted += batch.length;
                }
            }
            // ── Anuncio (para join con GHL attribution_ad_id) ───────────────────
            // Disponible solo después de aplicar migración 011
            try {
                const adInsights = await (0, meta_js_1.fetchAdInsights)(sinceDate, until);
                console.log(`[Sync] ${adInsights.length} registros de Meta (ad level) obtenidos`);
                for (let i = 0; i < adInsights.length; i += 500) {
                    const batch = adInsights.slice(i, i + 500).map((r) => ({
                        ...r,
                        synced_at: new Date().toISOString(),
                    }));
                    const { error } = await supabase_js_1.supabaseAdmin
                        .from('meta_ads')
                        .upsert(batch, { onConflict: 'ad_id,date_start,date_stop' });
                    if (error) {
                        // La tabla puede no existir aún si migración 011 no fue aplicada
                        if (!error.message.includes('does not exist')) {
                            errors.push(`meta_ads upsert batch ${i}: ${error.message}`);
                        }
                        else {
                            console.log('[Sync] Tabla meta_ads no existe aún — aplica migración 011');
                        }
                        break;
                    }
                    else {
                        meta_records_upserted += batch.length;
                    }
                }
                // ── Thumbnails y preview links ────────────────────────────────────
                if (adInsights.length > 0) {
                    try {
                        const uniqueAdIds = [...new Set(adInsights.map((a) => a.ad_id))];
                        const creatives = await (0, meta_js_1.fetchAdCreatives)(uniqueAdIds);
                        console.log(`[Sync] ${creatives.length} creatives obtenidos`);
                        for (const c of creatives) {
                            await supabase_js_1.supabaseAdmin
                                .from('meta_ads')
                                .update({
                                thumbnail_url: c.thumbnail_url,
                                preview_link: c.preview_link,
                                ad_status: c.ad_status,
                            })
                                .eq('ad_id', c.ad_id);
                        }
                    }
                    catch (cErr) {
                        console.warn('[Sync] fetchAdCreatives falló (no crítico):', cErr instanceof Error ? cErr.message : String(cErr));
                    }
                }
            }
            catch (adErr) {
                console.warn('[Sync] Ad-level insights falló (no crítico):', adErr instanceof Error ? adErr.message : String(adErr));
            }
            console.log(`[Sync] ${meta_records_upserted} registros de Meta upserted en total`);
            await setSyncState('last_meta_sync_at', new Date().toISOString());
        }
        catch (err) {
            errors.push(`meta sync: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    else {
        console.log('[Sync] Meta deshabilitado — META_ACCESS_TOKEN / META_AD_ACCOUNT_ID no configurados');
    }
    // ── Persistir timestamp de sync de contactos ───────────────────────────────
    // Solo actualizar si no hubo error en el fetch de contactos
    const contactFetchFailed = errors.some((e) => e.startsWith('fetchAllContacts'));
    if (!contactFetchFailed) {
        await setSyncState('last_contacts_sync_at', started_at);
    }
    const finished_at = new Date().toISOString();
    console.log(`[Sync] Finalizado. Errores: ${errors.length}`);
    return {
        leads_upserted,
        opportunities_upserted,
        pipelines_upserted,
        meta_records_upserted,
        incremental_contacts,
        errors,
        started_at,
        finished_at,
    };
}
