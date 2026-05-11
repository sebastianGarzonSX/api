"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tutorialsRouter = void 0;
const express_1 = require("express");
const supabase_js_1 = require("../lib/supabase.js");
const auth_js_1 = require("../middleware/auth.js");
const requireRole_js_1 = require("../middleware/requireRole.js");
exports.tutorialsRouter = (0, express_1.Router)();
// GET /api/tutorials
exports.tutorialsRouter.get('/', auth_js_1.authenticate, async (_req, res) => {
    try {
        const { data, error } = await supabase_js_1.supabaseAdmin
            .from('tutorials_config')
            .select('videos')
            .eq('id', 1)
            .single();
        if (error) {
            res.json({ videos: {} });
            return;
        }
        res.json({ videos: data?.videos ?? {} });
    }
    catch {
        res.json({ videos: {} });
    }
});
// POST /api/admin/tutorials
exports.tutorialsRouter.post('/admin', auth_js_1.authenticate, (0, requireRole_js_1.requireRole)('admin'), async (req, res) => {
    try {
        const { videos } = req.body;
        if (!videos) {
            res.status(400).json({ error: 'videos requerido' });
            return;
        }
        await supabase_js_1.supabaseAdmin
            .from('tutorials_config')
            .upsert({ id: 1, videos });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});
