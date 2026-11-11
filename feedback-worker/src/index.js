const API_PATH = '/api/feedback';
const MAX_BODY_BYTES = 8192;
const MAX_MESSAGE_LENGTH = 2000;

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

function jsonResponse(request, env, status, body) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin'
  });
  const origin = request.headers.get('Origin');
  if (origin && allowedOrigins(env).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function originIsAllowed(request, env) {
  const origin = request.headers.get('Origin');
  return !origin || (origin !== 'null' && allowedOrigins(env).includes(origin));
}

function constantTimeEqual(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}

function adminError(env, request) {
  if (!env.ADMIN_SECRET || env.ADMIN_SECRET.length < 32) {
    return jsonResponse(request, env, 503, { error: 'admin_not_configured' });
  }
  const supplied = request.headers.get('X-Admin-Secret') || '';
  if (!constantTimeEqual(supplied, env.ADMIN_SECRET)) {
    return jsonResponse(request, env, 403, { error: 'invalid_admin_secret' });
  }
  return null;
}

async function readBodyWithinLimit(request) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function submitFeedback(request, env) {
  if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
    return jsonResponse(request, env, 415, { error: 'json_required' });
  }
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return jsonResponse(request, env, 413, { error: 'payload_too_large' });
  }

  const bodyText = await readBodyWithinLimit(request);
  if (bodyText === null) {
    return jsonResponse(request, env, 413, { error: 'payload_too_large' });
  }

  let body;
  try { body = JSON.parse(bodyText); }
  catch { return jsonResponse(request, env, 400, { error: 'invalid_json' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse(request, env, 400, { error: 'invalid_feedback' });
  }

  if (typeof body.website === 'string' && body.website.trim()) {
    return jsonResponse(request, env, 400, { error: 'spam_detected' });
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length < 3 || message.length > MAX_MESSAGE_LENGTH) {
    return jsonResponse(request, env, 400, { error: 'invalid_feedback' });
  }

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  await env.DB.prepare(
    'INSERT INTO feedback (id, message, created_at) VALUES (?, ?, ?)'
  ).bind(id, message, createdAt).run();
  return jsonResponse(request, env, 201, { id, created_at: createdAt });
}

async function listFeedback(request, env) {
  const authFailure = adminError(env, request);
  if (authFailure) return authFailure;
  const result = await env.DB.prepare(
    'SELECT id, message, created_at FROM feedback ORDER BY created_at DESC LIMIT 300'
  ).all();
  return jsonResponse(request, env, 200, { feedback: result.results || [] });
}

async function deleteFeedback(request, env, id) {
  const authFailure = adminError(env, request);
  if (authFailure) return authFailure;
  const result = await env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(id).run();
  if (!result.meta || result.meta.changes === 0) {
    return jsonResponse(request, env, 404, { error: 'feedback_not_found' });
  }
  return jsonResponse(request, env, 200, { deleted: true });
}

export default {
  async fetch(request, env) {
    if (!originIsAllowed(request, env)) {
      return jsonResponse(request, env, 403, { error: 'origin_not_allowed' });
    }

    if (request.method === 'OPTIONS') {
      const headers = new Headers({
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin'
      });
      const origin = request.headers.get('Origin');
      if (origin) headers.set('Access-Control-Allow-Origin', origin);
      return new Response(null, { status: 204, headers });
    }

    const url = new URL(request.url);
    if (url.pathname !== API_PATH && !url.pathname.startsWith(API_PATH + '/')) {
      return jsonResponse(request, env, 404, { error: 'not_found' });
    }
    if (!env.DB) return jsonResponse(request, env, 503, { error: 'storage_not_configured' });

    try {
      if (request.method === 'POST' && url.pathname === API_PATH) {
        return await submitFeedback(request, env);
      }
      if (request.method === 'GET' && url.pathname === API_PATH) {
        return await listFeedback(request, env);
      }
      const match = url.pathname.match(/^\/api\/feedback\/([0-9a-f-]{36})$/i);
      if (request.method === 'DELETE' && match) {
        return await deleteFeedback(request, env, match[1]);
      }
      return jsonResponse(request, env, 405, { error: 'method_not_allowed' });
    } catch (error) {
      console.error('Feedback service request failed:', error);
      return jsonResponse(request, env, 500, { error: 'internal_error' });
    }
  }
};
