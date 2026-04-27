"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardRouter = void 0;
const express_1 = require("express");
const supabase_js_1 = require("../lib/supabase.js");
const auth_js_1 = require("../middleware/auth.js");
// =============================================================================
// GET /api/dashboard/kpis
// =============================================================================
// Agrega métricas de leads y oportunidades para los 4 KPI cards del dashboard.
// Accesible por cualquier rol autenticado.
//
// Implementación:
//   - Usa la función RPC `get_dashboard_kpis` (migración 007) para ejecutar
//     todas las agregaciones en una sola llamada a Supabase.
//   - Cache: el cliente Next.js hace revalidación cada 15 minutos vía hook.
// =============================================================================
exports.dashboardRouter = (0, express_1.Router)();
exports.dashboardRouter.get('/kpis', auth_js_1.authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase_js_1.supabaseAdmin.rpc('get_dashboard_kpis');
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
