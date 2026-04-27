"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metaRouter = void 0;
const express_1 = require("express");
const supabase_js_1 = require("../lib/supabase.js");
const auth_js_1 = require("../middleware/auth.js");
const requireRole_js_1 = require("../middleware/requireRole.js");
const meta_js_1 = require("../services/meta.js");
// =============================================================================
// GET /api/meta/campaigns
// =============================================================================
// Devuelve métricas de campañas de Meta Ads almacenadas en la DB.
// Los datos se actualizan en cada sync (cron o manual).
//
// Query params:
//   since  YYYY-MM-DD  (default: hace 30 días)
//   until  YYYY-MM-DD  (default: hoy)
// =============================================================================
exports.metaRouter = (0, express_1.Router)();
exports.metaRouter.get('/campaigns', auth_js_1.authenticate, async (req, res) => {
    try {
        const now = new Date();
        const until = req.query['until'] ?? now.toISOString().slice(0, 10);
        const since = req.query['since']
            ?? new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
        const { data, error } = await supabase_js_1.supabaseAdmin
            .from('meta_campaigns')
            .select('*')
            .gte('date_start', since)
            .lte('date_stop', until)
            .order('date_start', { ascending: false })
            .order('campaign_name', { ascending: true });
        if (error) {
            const err = { error: error.message, code: 'DB_ERROR', status: 500 };
            res.status(500).json(err);
            return;
        }
        const rows = (data ?? []);
        // Agregar por campaña para el resumen
        const summaryMap = new Map();
        for (const row of rows) {
            const existing = summaryMap.get(row.campaign_id);
            if (!existing) {
                summaryMap.set(row.campaign_id, {
                    campaign_id: row.campaign_id,
                    campaign_name: row.campaign_name,
                    total_impressions: row.impressions,
                    total_clicks: row.clicks,
                    total_spend: row.spend,
                    total_reach: row.reach,
                    avg_ctr: row.ctr,
                    avg_cpm: row.cpm,
                    total_conversions: row.conversions,
                    avg_cost_per_result: row.cost_per_result,
                });
            }
            else {
                existing.total_impressions += row.impressions;
                existing.total_clicks += row.clicks;
                existing.total_spend += row.spend;
                existing.total_reach += row.reach;
                // Para CTR y CPM: recalcular como promedio ponderado por impresiones
                // (aproximación: promedio simple es suficiente para el dashboard)
                existing.avg_ctr = existing.total_clicks / (existing.total_impressions || 1) * 100;
                existing.avg_cpm = existing.total_spend / (existing.total_impressions || 1) * 1000;
                existing.total_conversions += row.conversions;
                existing.avg_cost_per_result = existing.total_conversions > 0
                    ? existing.total_spend / existing.total_conversions
                    : 0;
            }
        }
        const response = {
            data: rows,
            summary: [...summaryMap.values()].sort((a, b) => b.total_spend - a.total_spend),
            since,
            until,
            total: rows.length,
        };
        res.json(response);
    }
    catch (err) {
        const apiErr = {
            error: err instanceof Error ? err.message : 'Error interno del servidor',
            status: 500,
        };
        res.status(500).json(apiErr);
    }
});
// =============================================================================
// POST /api/meta/extend-token
// =============================================================================
// Extiende un token de corta duración (2h) a larga duración (60 días).
// Solo admin. Requiere META_APP_ID y META_APP_SECRET configurados.
// Body: { token: string }
// =============================================================================
exports.metaRouter.post('/extend-token', auth_js_1.authenticate, (0, requireRole_js_1.requireRole)('admin'), async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) {
            res.status(400).json({ error: 'Se requiere el campo token en el body', status: 400 });
            return;
        }
        const result = await (0, meta_js_1.extendToken)(token);
        res.json({
            access_token: result.access_token,
            expires_in: result.expires_in,
            message: result.expires_in
                ? `Token extendido. Expira en ${Math.round(result.expires_in / 86_400)} días.`
                : 'Token permanente generado.',
        });
    }
    catch (err) {
        const apiErr = {
            error: err instanceof Error ? err.message : 'Error al extender token',
            status: 500,
        };
        res.status(500).json(apiErr);
    }
});
