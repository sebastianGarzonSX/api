"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchAllContacts = fetchAllContacts;
exports.fetchAllOpportunities = fetchAllOpportunities;
// =============================================================================
// Cliente GoHighLevel API v2
// Docs: https://highlevel.stoplight.io/docs/integrations
// Base: https://services.leadconnectorhq.com
// Auth: Authorization: Bearer {GHL_API_KEY}
//       Version: 2021-07-28
// =============================================================================
const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION = process.env.GHL_LOCATION_ID;
const GHL_VERSION = '2021-07-28';
if (!GHL_API_KEY || !GHL_LOCATION) {
    console.warn('[GHL] GHL_API_KEY o GHL_LOCATION_ID no definidos — sync deshabilitado.');
}
function ghlHeaders() {
    return {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Version': GHL_VERSION,
        'Content-Type': 'application/json',
    };
}
async function ghlFetch(path) {
    const url = `${GHL_BASE_URL}${path}`;
    const res = await fetch(url, { headers: ghlHeaders() });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`GHL ${res.status} en ${path}: ${body}`);
    }
    return res.json();
}
// ── Contactos ─────────────────────────────────────────────────────────────────
/**
 * Obtiene todos los contactos del location, manejando paginación automáticamente.
 * GHL usa cursor-based pagination con startAfterId.
 * Limit máximo por request: 100.
 */
async function fetchAllContacts() {
    const all = [];
    let startAfterId = null;
    while (true) {
        const params = new URLSearchParams({
            locationId: GHL_LOCATION,
            limit: '100',
        });
        if (startAfterId)
            params.set('startAfterId', startAfterId);
        const data = await ghlFetch(`/contacts/?${params.toString()}`);
        all.push(...data.contacts);
        if (!data.meta.startAfterId || data.contacts.length < 100)
            break;
        startAfterId = data.meta.startAfterId;
    }
    return all;
}
// ── Oportunidades ─────────────────────────────────────────────────────────────
/**
 * Obtiene todas las oportunidades del location, manejando paginación.
 * GHL usa paginación por página (page=1, 2, 3...) para opportunities.
 * Limit máximo por request: 100.
 */
async function fetchAllOpportunities() {
    const all = [];
    let page = 1;
    while (true) {
        const params = new URLSearchParams({
            location_id: GHL_LOCATION,
            limit: '100',
            page: String(page),
        });
        const data = await ghlFetch(`/opportunities/search?${params.toString()}`);
        all.push(...data.opportunities);
        if (!data.meta.nextPage || data.opportunities.length < 100)
            break;
        page++;
    }
    return all;
}
