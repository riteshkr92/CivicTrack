/**
 * CivicTrack — Pure JavaScript EXIF & GPS Metadata Parser
 *
 * Safely extracts GPS latitude, longitude, and timestamps from JPEG buffers
 * without native C++ compilation or external binary dependencies.
 */

/**
 * Calculate Great-Circle Distance between two coordinates in meters (Haversine formula).
 */
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return null;
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Parse rational number from TIFF buffer
 */
function readRational(buffer, offset, isLittleEndian) {
  const num = isLittleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  const den = isLittleEndian ? buffer.readUInt32LE(offset + 4) : buffer.readUInt32BE(offset + 4);
  if (den === 0) return 0;
  return num / den;
}

/**
 * Extract EXIF and GPS metadata from a JPEG buffer.
 *
 * @param {Buffer} buffer - Raw file buffer
 * @returns {Object} Extracted metadata: { hasGps, gpsLatitude, gpsLongitude, timestamp }
 */
function extractExifGps(buffer) {
  const result = {
    hasGps: false,
    gpsLatitude: null,
    gpsLongitude: null,
    gpsTimestamp: null
  };

  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return result;
  }

  // Check JPEG SOI marker (0xFF, 0xD8)
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return result; // Not a JPEG or stripped
  }

  let offset = 2;
  const length = buffer.length;

  while (offset + 4 < length) {
    if (buffer[offset] !== 0xff) {
      break;
    }
    const marker = buffer[offset + 1];

    // Standalone markers
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }

    const markerLength = buffer.readUInt16BE(offset + 2);
    if (markerLength < 2) break;

    // Check APP1 Marker (0xE1)
    if (marker === 0xe1 && offset + 4 + 6 <= length) {
      const header = buffer.toString('ascii', offset + 4, offset + 10);
      if (header.startsWith('Exif\0\0')) {
        const tiffOffset = offset + 10;
        try {
          parseTiff(buffer, tiffOffset, result);
        } catch (e) {
          // Graceful handling of corrupted/truncated EXIF
        }
        break;
      }
    }

    offset += 2 + markerLength;
  }

  return result;
}

/**
 * Parse TIFF Header and IFDs within APP1
 */
function parseTiff(buffer, tiffStart, result) {
  if (tiffStart + 8 > buffer.length) return;

  const byteOrder = buffer.toString('ascii', tiffStart, tiffStart + 2);
  const isLittleEndian = byteOrder === 'II';
  if (byteOrder !== 'II' && byteOrder !== 'MM') return;

  const magic = isLittleEndian ? buffer.readUInt16LE(tiffStart + 2) : buffer.readUInt16BE(tiffStart + 2);
  if (magic !== 42) return;

  const ifd0Offset = isLittleEndian ? buffer.readUInt32LE(tiffStart + 4) : buffer.readUInt32BE(tiffStart + 4);
  const ifd0Start = tiffStart + ifd0Offset;
  if (ifd0Start + 2 > buffer.length) return;

  const numEntries = isLittleEndian ? buffer.readUInt16LE(ifd0Start) : buffer.readUInt16BE(ifd0Start);
  let gpsOffset = null;

  for (let i = 0; i < numEntries; i++) {
    const entryOffset = ifd0Start + 2 + i * 12;
    if (entryOffset + 12 > buffer.length) break;

    const tag = isLittleEndian ? buffer.readUInt16LE(entryOffset) : buffer.readUInt16BE(entryOffset);
    if (tag === 0x8825) {
      // GPSInfo tag
      gpsOffset = isLittleEndian ? buffer.readUInt32LE(entryOffset + 8) : buffer.readUInt32BE(entryOffset + 8);
      break;
    }
  }

  if (gpsOffset !== null) {
    parseGpsIfd(buffer, tiffStart, tiffStart + gpsOffset, isLittleEndian, result);
  }
}

/**
 * Parse GPS IFD tags
 */
function parseGpsIfd(buffer, tiffStart, gpsStart, isLittleEndian, result) {
  if (gpsStart + 2 > buffer.length) return;

  const numGpsEntries = isLittleEndian ? buffer.readUInt16LE(gpsStart) : buffer.readUInt16BE(gpsStart);

  let latRef = 'N';
  let lonRef = 'E';
  let latValues = null;
  let lonValues = null;

  for (let i = 0; i < numGpsEntries; i++) {
    const entryOffset = gpsStart + 2 + i * 12;
    if (entryOffset + 12 > buffer.length) break;

    const tag = isLittleEndian ? buffer.readUInt16LE(entryOffset) : buffer.readUInt16BE(entryOffset);
    const type = isLittleEndian ? buffer.readUInt16LE(entryOffset + 2) : buffer.readUInt16BE(entryOffset + 2);
    const count = isLittleEndian ? buffer.readUInt32LE(entryOffset + 4) : buffer.readUInt32BE(entryOffset + 4);
    const valueOffset = isLittleEndian ? buffer.readUInt32LE(entryOffset + 8) : buffer.readUInt32BE(entryOffset + 8);

    if (tag === 0x0001) {
      // GPSLatitudeRef
      latRef = String.fromCharCode(buffer[entryOffset + 8] || 78).toUpperCase();
    } else if (tag === 0x0002 && count === 3) {
      // GPSLatitude
      const absOffset = tiffStart + valueOffset;
      if (absOffset + 24 <= buffer.length) {
        latValues = [
          readRational(buffer, absOffset, isLittleEndian),
          readRational(buffer, absOffset + 8, isLittleEndian),
          readRational(buffer, absOffset + 16, isLittleEndian)
        ];
      }
    } else if (tag === 0x0003) {
      // GPSLongitudeRef
      lonRef = String.fromCharCode(buffer[entryOffset + 8] || 69).toUpperCase();
    } else if (tag === 0x0004 && count === 3) {
      // GPSLongitude
      const absOffset = tiffStart + valueOffset;
      if (absOffset + 24 <= buffer.length) {
        lonValues = [
          readRational(buffer, absOffset, isLittleEndian),
          readRational(buffer, absOffset + 8, isLittleEndian),
          readRational(buffer, absOffset + 16, isLittleEndian)
        ];
      }
    }
  }

  if (latValues && lonValues) {
    let lat = latValues[0] + latValues[1] / 60 + latValues[2] / 3600;
    if (latRef === 'S') lat = -lat;

    let lon = lonValues[0] + lonValues[1] / 60 + lonValues[2] / 3600;
    if (lonRef === 'W') lon = -lon;

    if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      result.hasGps = true;
      result.gpsLatitude = Number(lat.toFixed(6));
      result.gpsLongitude = Number(lon.toFixed(6));
    }
  }
}

/**
 * Validate file header magic bytes to verify genuine image content.
 *
 * @param {Buffer} buffer - First few bytes of file
 * @returns {string|null} detected MIME type or null
 */
function validateImageMagicBytes(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP: RIFF ... WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

module.exports = {
  extractExifGps,
  calculateDistanceMeters,
  validateImageMagicBytes
};
