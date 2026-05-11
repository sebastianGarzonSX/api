"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.announcementsRouter = void 0;
const express_1 = require("express");
const supabase_js_1 = require("../lib/supabase.js");
const auth_js_1 = require("../middleware/auth.js");
const requireRole_js_1 = require("../middleware/requireRole.js");
exports.announcementsRouter = (0, express_1.Router)();
// GET /api/announcements — public (no auth required for display)
exports.announcementsRouter.get('/', async (_req, res) => {
    try {
        const { data, error } = await supabase_js_1.supabaseAdmin
            .from('announcements')
            .select('id, message, type, emoji, active, created_at')
            .eq('active', true)
            .order('created_at', { ascending: false });
        if (error) {
            res.status(500).json({ error: error.message });
            return;
        }
        res.json(data ?? []);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});
// GET /api/admin/announcements — admin: all banners
exports.announcementsRouter.get('/admin', auth_js_1.authenticate, (0, requireRole_js_1.requireRole)('admin'), async (_req, res) => {
    try {
        const { data, error } = await supabase_js_1.supabaseAdmin
            .from('announcements')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) {
            res.status(500).json({ error: error.message });
            return;
        }
        res.json(data ?? []);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});
// POST /api/admin/announcements — create or delete
exports.announcementsRouter.post('/admin', auth_js_1.authenticate, (0, requireRole_js_1.requireRole)('admin'), async (req, res) => {
    try {
        const body = req.body;
        if (body._delete && body.id) {
            await supabase_js_1.supabaseAdmin.from('announcements').delete().eq('id', body.id);
            res.json({ success: true });
            return;
        }
        if (!body.message) {
            res.status(400).json({ error: 'message requerido' });
            return;
        }
        const { data, error } = await supabase_js_1.supabaseAdmin
            .from('announcements')
            .insert({ message: body.message, type: body.type ?? 'info', emoji: body.emoji ?? '📢' })
            .select()
            .single();
        if (error) {
            res.status(500).json({ error: error.message });
            return;
        }
        res.json(data);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});
// POST /api/admin/announcements/toggle
exports.announcementsRouter.post('/admin/toggle', auth_js_1.authenticate, (0, requireRole_js_1.requireRole)('admin'), async (req, res) => {
    try {
        const { id, active } = req.body;
        if (!id) {
            res.status(400).json({ error: 'id requerido' });
            return;
        }
        await supabase_js_1.supabaseAdmin.from('announcements').update({ active }).eq('id', id);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});
