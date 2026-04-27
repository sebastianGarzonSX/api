"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportsRouter = void 0;
const express_1 = require("express");
const supabase_js_1 = require("../lib/supabase.js");
const auth_js_1 = require("../middleware/auth.js");
// =============================================================================
// GET /api/reports/attribution
// =============================================================================
// Informe unificado GHL + Meta:
//   - Leads por anuncio de Meta (cruzado con gasto Meta si está conectado)
//   - Funnel por pipeline (producto)
//   - Distribución por tags
//   - Totales Meta del período
//
// Query params:
//   since  YYYY-MM-DD  (default: hace 30 días)
//   until  YYYY-MM-DD  (default: hoy)
// =============================================================================
exports.reportsRouter = (0, express_1.Router)();
exports.reportsRouter.get('/attribution', auth_js_1.authenticate, async (req, res) => {
    try {
        const now = new Date();
        const until = req.query['until'] ?? now.toISOString().slice(0, 10);
        const since = req.query['since']
            ?? new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
        const { data, error } = await supabase_js_1.supabaseAdmin.rpc('get_attribution_report', {
            p_since: since,
            p_until: until,
        });
        if (error) {
            const err = { error: error.message, code: 'DB_ERROR', status: 500 };
            res.status(500).json(err);
            return;
        }
        res.json(data);
    }
    catch (err) {
        const apiErr = {
            error: err instanceof Error ? err.message : 'Error interno del servidor',
            status: 500,
        };
        res.status(500).json(apiErr);
    }
});
