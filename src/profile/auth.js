'use strict';

const crypto = require('node:crypto');

function setNoStore(res) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Cache-Control', 'no-store');
  }
}

function readHeader(req, name) {
  if (typeof req.get === 'function') return req.get(name) || '';
  const headers = req.headers || {};
  return headers[name.toLowerCase()] || headers[name] || '';
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireProfileAuth(req, res) {
  setNoStore(res);

  const provided = String(readHeader(req, 'x-profile-internal-token')).trim();
  if (!provided) {
    res.status(401).json({ error: 'Unauthorized', code: 'unauthorized' });
    return false;
  }

  const expected = process.env.PROFILE_INTERNAL_API_TOKEN || '';
  if (expected.length < 32) {
    res.status(500).json({ error: 'Server misconfiguration', code: 'missing_profile_auth' });
    return false;
  }

  if (!safeEqual(provided, expected)) {
    res.status(401).json({ error: 'Unauthorized', code: 'unauthorized' });
    return false;
  }

  return true;
}

module.exports = { requireProfileAuth, setNoStore };
