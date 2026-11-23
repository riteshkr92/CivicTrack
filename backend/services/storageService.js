const path = require('path');
const { createClient } = require('@supabase/supabase-js');

/**
 * CivicTrack — Private Cloud Storage Service (Supabase Storage)
 *
 * Provides server-side operations against private Supabase Storage buckets.
 * - Credentials are read exclusively from process.env and never logged or exposed.
 * - Enforces simple filename validation to prevent path traversal attacks.
 * - Never creates public URLs or alters bucket accessibility.
 */

const DEFAULT_BUCKET = 'civictrack-private-evidence';

// Supabase client instance cached or lazily initialized from process.env
let supabaseClient = null;

function getClient() {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.trim() : null;
  const key = process.env.SUPABASE_SECRET_KEY ? process.env.SUPABASE_SECRET_KEY.trim() : null;

  if (url && key) {
    try {
      supabaseClient = createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      });
      return supabaseClient;
    } catch (_) {
      supabaseClient = null;
    }
  }
  return null;
}

/**
 * Validate that a filename is a clean, simple filename with no path components.
 * Rejects empty names, slashes, backslashes, '..', and control characters.
 *
 * @param {string} filename
 * @returns {string} The validated filename
 */
function validateFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid filename: Filename must be a non-empty string.');
  }

  const trimmed = filename.trim();
  if (!trimmed || trimmed !== filename) {
    throw new Error('Invalid filename: Leading or trailing whitespace is not allowed.');
  }

  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new Error('Invalid filename: Path traversal sequences and slashes are strictly forbidden.');
  }

  // Reject null bytes and control characters
  if (/[\x00-\x1F\x7F]/.test(filename)) {
    throw new Error('Invalid filename: Control characters are not permitted.');
  }

  if (path.basename(filename) !== filename) {
    throw new Error('Invalid filename: Must be a pure filename without path segments.');
  }

  return filename;
}

/**
 * Ensure Supabase Storage is configured before executing cloud operations.
 * Throws a clear error if unconfigured.
 */
function ensureConfigured() {
  const client = getClient();
  if (!client) {
    const err = new Error('Supabase Storage is not configured. Missing SUPABASE_URL or SUPABASE_SECRET_KEY.');
    err.statusCode = 503;
    throw err;
  }
  return client;
}

/**
 * Sanitize an error to ensure secrets and sensitive strings are never included.
 *
 * @param {Error|Object} err
 * @param {string} fallbackMessage
 * @returns {Error}
 */
function sanitizeError(err, fallbackMessage) {
  let message = err?.message || String(err || fallbackMessage);
  const secretKey = process.env.SUPABASE_SECRET_KEY ? process.env.SUPABASE_SECRET_KEY.trim() : null;
  if (secretKey && message.includes(secretKey)) {
    message = message.replace(new RegExp(secretKey, 'g'), '[REDACTED]');
  }
  const cleanError = new Error(`${fallbackMessage}: ${message}`);
  if (err?.statusCode) cleanError.statusCode = err.statusCode;
  if (err?.status) cleanError.status = err.status;
  if (message.includes('Object not found') || err?.statusCode === 404 || err?.status === 404) {
    cleanError.isNotFound = true;
    cleanError.statusCode = 404;
  }
  return cleanError;
}

/**
 * Check whether Supabase Storage is fully configured and ready for use.
 *
 * @returns {boolean}
 */
function isConfigured() {
  return Boolean(getClient());
}

/**
 * Get the configured private storage bucket name.
 *
 * @returns {string}
 */
function getBucketName() {
  return (process.env.SUPABASE_STORAGE_BUCKET && process.env.SUPABASE_STORAGE_BUCKET.trim())
    ? process.env.SUPABASE_STORAGE_BUCKET.trim()
    : DEFAULT_BUCKET;
}

/**
 * Upload a Buffer to the private Supabase Storage bucket using the exact filename as object key.
 * Uses upsert: false to prevent unintended overwrites.
 *
 * @param {string} filename - Clean object filename
 * @param {Buffer} buffer - Node.js binary Buffer
 * @param {string} [mimeType='application/octet-stream'] - File Content-Type
 * @returns {Promise<{ key: string, path: string, id?: string }>} Success metadata
 */
async function uploadFile(filename, buffer, mimeType = 'application/octet-stream') {
  const safeFilename = validateFilename(filename);
  const client = ensureConfigured();

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Upload error: A non-empty Node.js Buffer is required for file upload.');
  }

  try {
    const { data, error } = await client.storage
      .from(getBucketName())
      .upload(safeFilename, buffer, {
        contentType: mimeType || 'application/octet-stream',
        upsert: false
      });

    if (error) {
      throw sanitizeError(error, 'Supabase storage upload failed');
    }

    return {
      key: data?.path || safeFilename,
      path: data?.path || safeFilename,
      id: data?.id || null
    };
  } catch (err) {
    throw sanitizeError(err, 'Failed to upload file to storage');
  }
}

/**
 * Download a file from the private Supabase Storage bucket and return it as a Node.js Buffer.
 *
 * @param {string} filename - Clean object filename
 * @returns {Promise<Buffer>} Node.js Buffer containing file binary data
 */
async function getFileBuffer(filename) {
  const safeFilename = validateFilename(filename);
  const client = ensureConfigured();

  try {
    const { data, error } = await client.storage
      .from(getBucketName())
      .download(safeFilename);

    if (error) {
      throw sanitizeError(error, `Failed to download '${safeFilename}' from storage`);
    }

    if (!data) {
      throw new Error(`Storage returned empty data for '${safeFilename}'.`);
    }

    // Convert returned Blob to Node.js Buffer
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    throw sanitizeError(err, `Failed to retrieve file '${safeFilename}'`);
  }
}

/**
 * Delete a file from the private Supabase Storage bucket.
 *
 * @param {string} filename - Clean object filename
 * @returns {Promise<{ success: boolean, removed: Array }>}
 */
async function deleteFile(filename) {
  const safeFilename = validateFilename(filename);
  const client = ensureConfigured();

  try {
    const { data, error } = await client.storage
      .from(getBucketName())
      .remove([safeFilename]);

    if (error) {
      throw sanitizeError(error, `Failed to delete '${safeFilename}' from storage`);
    }

    return {
      success: true,
      removed: data || []
    };
  } catch (err) {
    throw sanitizeError(err, `Failed to delete file '${safeFilename}'`);
  }
}

module.exports = {
  isConfigured,
  getBucketName,
  uploadFile,
  getFileBuffer,
  deleteFile
};
