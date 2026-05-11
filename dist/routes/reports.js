"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportsRouter = void 0;
const express_1 = require("express");
const supabase_js_1 = require("../lib/supabase.js");
const auth_js_1 = require("../middleware/auth.js");
exports.reportsRouter = (0, express_1.Router)();
// GET /api/reports/attribution?since=&until=&tag=
exports.reportsRouter.get('/attribution', auth_js_1.authenticate, async (req, res) => {
    try {
        const now = new Date();
        const until = req.query['until'] ?? now.toISOString().slice(0, 10);
        const since = req.query['since']
            ?? new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
        const tag = req.query['tag'] ?? null;
        const { data, error } = await supabase_js_1.supabaseAdmin.rpc('get_attribution_report', {
            p_since: since,
            p_until: until,
            p_tag: tag,
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
// GET /api/reports/events?since=&until=
// Devuelve tags únicos con conteos para el selector de evento/ciudad
exports.reportsRouter.get('/events', auth_js_1.authenticate, async (req, res) => {
    try {
        const now = new Date();
        const until = req.query['until'] ?? now.toISOString().slice(0, 10);
        const since = req.query['since']
            ?? new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
        const { data, error } = await supabase_js_1.supabaseAdmin.rpc('get_lead_tags', {
            p_since: since,
            p_until: until,
        });
        if (error) {
            const err = { error: error.message, code: 'DB_ERROR', status: 500 };
            res.status(500).json(err);
            return;
        }
        res.json(data ?? []);
    }
    catch (err) {
        const apiErr = {
            error: err instanceof Error ? err.message : 'Error interno del servidor',
            status: 500,
        };
        res.status(500).json(apiErr);
    }
});
