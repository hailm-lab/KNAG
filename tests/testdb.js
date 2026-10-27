'use strict';
/* Cơ sở dữ liệu tạm cho kiểm thử: mỗi lần chạy tạo một database PostgreSQL riêng (bg_test_…) rồi xóa đi, không đụng dữ liệu thật.
   Dùng PostgreSQL riêng của dự án (server/pg-local.js); hoặc đặt TEST_ADMIN_URL tới một máy chủ PostgreSQL có quyền tạo database. */
const { Client } = require('pg');
const pgLocal = require('../server/pg-local');

async function adminUrl() { if (process.env.TEST_ADMIN_URL) return process.env.TEST_ADMIN_URL; await pgLocal.ensure(); return pgLocal.url('postgres'); }
function urlWithDb(base, name) { const u = new URL(base); u.pathname = '/' + name; return u.toString(); }

module.exports = async function createTestDb(prefix) {
  const base = await adminUrl(); const name = `bg_test_${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const a = new Client({ connectionString: base }); await a.connect(); await a.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`); await a.end();
  const url = urlWithDb(base, name); process.env.DATABASE_URL = url;
  return { url, name, async drop() { const db = require('../server/db'); await db.close(); const c = new Client({ connectionString: base }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await c.end(); } };
};
