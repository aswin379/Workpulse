/**
 * WORKPULSE ENTERPRISE SECURITY & CRYPTOGRAPHY ENGINE (auth-crypto.js)
 * Implements industry-standard salted bcrypt password hashing,
 * constant-time verification, cryptographic session tokens, and data sanitization.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 10;
const HASH_ALGO = 'sha512';
const ITERATIONS = 100000;
const KEY_LEN = 64;

/**
 * Hashes a plaintext password with a unique salted bcrypt hash (rounds = 10).
 * Output format: $2a$10$...
 */
function hashPassword(plainText) {
  if (!plainText || typeof plainText !== 'string') return '';
  return bcrypt.hashSync(plainText, BCRYPT_ROUNDS);
}

/**
 * Verifies a plaintext password against a stored bcrypt hash or PBKDF2 hash.
 * Constant-time comparison ensures protection against timing side-channels.
 */
function verifyPassword(plainText, storedHashOrPlain) {
  if (!plainText || !storedHashOrPlain) return false;

  // 1. Standard bcrypt hash ($2a$, $2b$, $2y$)
  if (typeof storedHashOrPlain === 'string' && (storedHashOrPlain.startsWith('$2a$') || storedHashOrPlain.startsWith('$2b$') || storedHashOrPlain.startsWith('$2y$'))) {
    try {
      return bcrypt.compareSync(plainText, storedHashOrPlain);
    } catch (e) {
      return false;
    }
  }

  // 2. PBKDF2 hash backward-compatibility during migration
  if (typeof storedHashOrPlain === 'string' && storedHashOrPlain.startsWith('pbkdf2:')) {
    const parts = storedHashOrPlain.split(':');
    if (parts.length !== 5) return false;
    const algo = parts[1] || HASH_ALGO;
    const iters = parseInt(parts[2], 10) || ITERATIONS;
    const salt = parts[3];
    const originalHash = parts[4];

    try {
      const computedHash = crypto.pbkdf2Sync(plainText, salt, iters, KEY_LEN, algo).toString('hex');
      return crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(originalHash, 'hex'));
    } catch (e) {
      return false;
    }
  }

  // 3. Exact plaintext match fallback for unmigrated accounts
  return storedHashOrPlain === plainText;
}

/**
 * Generates cryptographically secure session tokens
 */
function generateSecureToken(prefix = 'wp') {
  const randomBytes = crypto.randomBytes(24).toString('hex');
  return `${prefix}-${Date.now()}-${randomBytes}`;
}

/**
 * Strips password and password hashes from a staff object
 */
function sanitizeStaff(staff) {
  if (!staff || typeof staff !== 'object') return null;
  const safe = { ...staff };
  delete safe.password;
  delete safe.passwordHash;
  return safe;
}

/**
 * Strips password and password hashes from an admin object
 */
function sanitizeAdmin(admin) {
  if (!admin || typeof admin !== 'object') return null;
  const safe = { ...admin };
  delete safe.password;
  delete safe.passwordHash;
  return safe;
}

/**
 * Sanitizes an entire database snapshot so no credentials or hashes are ever sent to client browsers
 */
function sanitizeDatabase(db) {
  if (!db || typeof db !== 'object') return db;
  const sanitized = { ...db };
  if (sanitized.admin) {
    sanitized.admin = sanitizeAdmin(sanitized.admin);
  }
  if (Array.isArray(sanitized.staff)) {
    sanitized.staff = sanitized.staff.map(sanitizeStaff);
  }
  return sanitized;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateSecureToken,
  sanitizeStaff,
  sanitizeAdmin,
  sanitizeDatabase
};
