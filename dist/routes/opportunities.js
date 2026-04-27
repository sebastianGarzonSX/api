"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.opportunitiesRouter = void 0;
const express_1 = require("express");
const supabase_js_1 = require("../lib/supabase.js");
const auth_js_1 = require("../middleware/auth.js");
// =============================================================================
// GET /api/opportunities          — Lista paginada de oportunidades
// GET /api/opportunities/pipeline — Agrupación por stage para el gráfico
// =============================================================================
exports.opportunitiesRouter = (0, express_1.Router)();
const VALID_STATUSES = ['open', 'won', 'lost'];
// ── GET /api/opportunities ────────────────────────────────────────────────────
exports.opportunitiesRouter.get('/', auth_js_1.authenticate, async (req, res) => {
    const page = Math.max(1, parseInt(String(req.query.page ?? 1), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 10), 10) || 10));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const status = req.query.status;
    const pipeline_id = req.query.pipeline_id;
    const stage_name = req.query.stage_name;
    const date_from = req.query.date_from;
    const date_to = req.query.date_to;
    if (status && !VALID_STATUSES.includes(status)) {
        const err = { error: `Status inválido: ${status}`, code: 'INVALID_PARAM', status: 400 };
        res.status(400).json(err);
        return;
    }
    try {
        // JOIN con leads para devolver nombre/email del contacto
        let query = supabase_js_1.supabaseAdmin
            .from('opportunities')
            .select('id, ghl_opportunity_id, lead_id, pipeline_id, stage_name, value, status, created_at, lead:leads(id, name, email, source)', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, to);
        if (status)
            query = query.eq('status', status);
        if (pipeline_id)
            query = query.eq('pipeline_id', pipeline_id);
        if (stage_name)
            query = query.eq('stage_name', stage_name);
        if (date_from)
            query = query.gte('created_at', date_from);
        if (date_to)
            query = query.lte('created_at', date_to);
        const { data, error, count } = await query;
        if (error) {
            const err = { error: error.message, code: 'DB_ERROR', status: 500 };
            res.status(500).json(err);
            return;
        }
        const total = count ?? 0;
        const total_pages = Math.ceil(total / limit);
        // Para viewers: omitir el campo value de la respuesta
        const safeData = req.user?.role === 'viewer'
            ? (data ?? []).map((row) => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { value: _v, ...rest } = row;
                return rest;
            })
            : data;
        res.json({
            data: safeData,
            meta: { total, page, limit, total_pages },
        });
    }
    catch (err) {
        const apiErr = {
            error: err instanceof Error ? err.message : 'Error interno del servidor',
            status: 500,
        };
        res.status(500).json(apiErr);
    }
});
// ── GET /api/opportunities/pipeline ──────────────────────────────────────────
exports.opportunitiesRouter.get('/pipeline', auth_js_1.authenticate, async (req, res) => {
    const canViewFinancials = req.user?.role !== 'viewer';
    try {
        // Fetch todas las oportunidades abiertas para agrupar por stage
        // Para volúmenes grandes (>10k), reemplazar con función RPC
        const { data, error } = await supabase_js_1.supabaseAdmin
            .from('opportunities')
            .select('stage_name, value')
            .eq('status', 'open');
        if (error) {
            const err = { error: error.message, code: 'DB_ERROR', status: 500 };
            res.status(500).json(err);
            return;
        }
        // Agrupar en memoria
        const stageMap = new Map();
        for (const opp of data ?? []) {
            const entry = stageMap.get(opp.stage_name) ?? { count: 0, total_value: 0 };
            entry.count++;
            entry.total_value += opp.value ?? 0;
            stageMap.set(opp.stage_name, entry);
        }
        const total = [...stageMap.values()].reduce((s, e) => s + e.count, 0);
        const pipeline = [...stageMap.entries()]
            .map(([stage_name, { count, total_value }]) => ({
            stage_name,
            count,
            total_value: canViewFinancials ? total_value : 0,
            percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
        }))
            .sort((a, b) => b.count - a.count);
        res.json(pipeline);
    }
    catch (err) {
        const apiErr = {
            error: err instanceof Error ? err.message : 'Error interno del servidor',
            status: 500,
        };
        res.status(500).json(apiErr);
    }
});
