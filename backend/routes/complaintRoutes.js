const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { Complaint, VALID_CATEGORIES, VALID_STATUSES } = require('../models/Complaint');
const User = require('../models/User');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const { extractExifGps, calculateDistanceMeters, validateImageMagicBytes } = require('../utils/exifParser');
const { sendNotification } = require('../utils/notificationService');
const { analyzeComplaint, findPotentialDuplicates } = require('../utils/aiService');
const { calculateSlaDeadlines, calculateReworkDeadline } = require('../config/slaPolicy');
const storageService = require('../services/storageService');

const router = express.Router();

// Middleware: Authenticate requests, supporting optional authentication for public tracking references
const authenticateOrOptional = (req, res, next) => {
  if (req.method === 'GET' && req.path.startsWith('/track/')) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }
  }
  return authenticate(req, res, next);
};

router.use(authenticateOrOptional);

// Permitted status state machine transitions
const PERMITTED_TRANSITIONS = {
  'Submitted': ['Under Review', 'Rejected'],
  'Under Review': ['In Progress', 'Rejected'],
  'In Progress': ['Provisionally Resolved', 'Rejected'],
  'Provisionally Resolved': ['Resolved', 'Disputed'],
  'Disputed': ['Resolved', 'In Progress'],
  'Resolved': [], // Terminal state
  'Rejected': [] // Terminal state
};

// Storage configuration for evidence photos
const rawUploadDir = process.env.UPLOAD_DIR || 'uploads/evidence';
const UPLOAD_DIR = path.isAbsolute(rawUploadDir)
  ? rawUploadDir
  : path.resolve(__dirname, '..', rawUploadDir);
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    const prefix = file.fieldname === 'completionPhoto'
      ? 'completion'
      : file.fieldname === 'disputePhoto'
      ? 'dispute'
      : 'evidence';
    cb(null, `${prefix}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${cleanExt}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_UPLOAD_SIZE_BYTES, 10) || 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format. Only JPEG, PNG, and WebP images are permitted.'));
    }
  }
});

// Robust path containment helper that defends against path traversal and sibling directory attacks
const isPathInsideDirectory = (baseDir, targetPath) => {
  if (!baseDir || !targetPath) return false;
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
};

// Safe disk cleanup helper for newly uploaded multipart files on request rejection/failure
const cleanupUploadedFiles = (req) => {
  const filePaths = [];
  if (req.file && req.file.path) filePaths.push(req.file.path);
  if (req.files) {
    if (Array.isArray(req.files)) {
      req.files.forEach((f) => f && f.path && filePaths.push(f.path));
    } else if (typeof req.files === 'object') {
      Object.values(req.files).forEach((arr) => {
        if (Array.isArray(arr)) {
          arr.forEach((f) => f && f.path && filePaths.push(f.path));
        }
      });
    }
  }
  const uniquePaths = [...new Set(filePaths)];
  for (const fp of uniquePaths) {
    if (fs.existsSync(fp)) {
      try {
        fs.unlinkSync(fp);
      } catch (err) {
        console.error(`Failed to clean up temporary upload file ${fp}:`, err.message);
      }
    }
  }
};

const uploadEvidence = upload.fields([
  { name: 'evidence', maxCount: 1 },
  { name: 'photo', maxCount: 1 }
]);

const handleUpload = (req, res, next) => {
  uploadEvidence(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Uploaded photograph exceeds the maximum permitted size of 10MB.'
          });
        }
        return res.status(400).json({
          error: 'Bad Request',
          message: `Upload error: ${err.message}`
        });
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: err.message || 'File upload error.'
      });
    }

    if (req.files) {
      if (req.files.evidence && req.files.evidence[0]) {
        req.file = req.files.evidence[0];
      } else if (req.files.photo && req.files.photo[0]) {
        req.file = req.files.photo[0];
      }
    }
    next();
  });
};

const uploadCompletionPhoto = upload.fields([
  { name: 'completionPhoto', maxCount: 1 },
  { name: 'photo', maxCount: 1 }
]);

const handleCompletionUpload = (req, res, next) => {
  uploadCompletionPhoto(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Uploaded completion photograph exceeds the maximum permitted size of 10MB.'
          });
        }
        return res.status(400).json({
          error: 'Bad Request',
          message: `Upload error: ${err.message}`
        });
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: err.message || 'File upload error.'
      });
    }

    if (req.files) {
      if (req.files.completionPhoto && req.files.completionPhoto[0]) {
        req.file = req.files.completionPhoto[0];
      } else if (req.files.photo && req.files.photo[0]) {
        req.file = req.files.photo[0];
      }
    }
    next();
  });
};

const uploadDisputePhoto = upload.fields([
  { name: 'disputePhoto', maxCount: 1 },
  { name: 'photo', maxCount: 1 }
]);

const handleDisputeUpload = (req, res, next) => {
  uploadDisputePhoto(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Uploaded dispute photograph exceeds the maximum permitted size of 10MB.'
          });
        }
        return res.status(400).json({
          error: 'Bad Request',
          message: `Upload error: ${err.message}`
        });
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: err.message || 'File upload error.'
      });
    }

    if (req.files) {
      if (req.files.disputePhoto && req.files.disputePhoto[0]) {
        req.file = req.files.disputePhoto[0];
      } else if (req.files.photo && req.files.photo[0]) {
        req.file = req.files.photo[0];
      }
    }
    next();
  });
};

/**
 * @route   POST /api/complaints
 * @desc    Submit a new civic complaint with mandatory geotagged photo evidence
 * @access  Protected (Authenticated Citizen)
 */
router.post('/', handleUpload, async (req, res, next) => {
  let uploadedFilePath = req.file ? req.file.path : null;
  try {
    const {
      title,
      description,
      category,
      location,
      address,
      latitude,
      longitude,
      evidenceLatitude,
      evidenceLongitude,
      evidenceAccuracy,
      evidenceCapturedAt,
      evidenceLocationSource,
      photoSource,
      captureSource,
      photoBase64,
      photo
    } = req.body;

    // 1. Validate Title
    if (!title || typeof title !== 'string' || title.trim().length < 3) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Title is required and must be at least 3 characters long.'
      });
    }
    const trimmedTitle = title.trim();
    if (trimmedTitle.length > 150) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Title cannot exceed 150 characters.'
      });
    }

    // 2. Validate Description
    if (!description || typeof description !== 'string' || description.trim().length < 10) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Description is required and must be at least 10 characters long.'
      });
    }
    const trimmedDescription = description.trim();
    if (trimmedDescription.length > 2000) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Description cannot exceed 2000 characters.'
      });
    }

    // 3. Validate Category
    if (!category || typeof category !== 'string' || !VALID_CATEGORIES.includes(category.trim())) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`
      });
    }
    const validatedCategory = category.trim();

    // 4. Validate Mandatory Issue Photograph
    let fileBuffer = null;
    let storageFilename = null;
    let originalName = 'issue-photo.jpg';
    let fileMime = 'image/jpeg';
    let fileSize = 0;

    if (req.file) {
      storageFilename = req.file.filename;
      originalName = req.file.originalname;
      fileMime = req.file.mimetype;
      fileSize = req.file.size;
      fileBuffer = fs.readFileSync(req.file.path);
    } else if (photoBase64 || (typeof photo === 'string' && photo.startsWith('data:image/'))) {
      const rawBase64 = photoBase64 || photo;
      const matches = rawBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      const base64Data = matches ? matches[2] : rawBase64;
      try {
        fileBuffer = Buffer.from(base64Data, 'base64');
        fileSize = fileBuffer.length;
        const ext = matches && matches[1].includes('png') ? '.png' : matches && matches[1].includes('webp') ? '.webp' : '.jpg';
        storageFilename = `evidence-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
        uploadedFilePath = path.join(UPLOAD_DIR, storageFilename);
        fs.writeFileSync(uploadedFilePath, fileBuffer);
        fileMime = matches ? matches[1] : 'image/jpeg';
      } catch (e) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Malformed photograph data.'
        });
      }
    } else {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Mandatory issue photograph is required. Please capture or upload a photograph documenting the civic issue.'
      });
    }

    // Validate file magic bytes
    const detectedMime = validateImageMagicBytes(fileBuffer);
    if (!detectedMime) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        fs.unlinkSync(uploadedFilePath);
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Uploaded file is not a valid image format (JPEG, PNG, or WebP required).'
      });
    }

    // 5. Validate Evidence Geotagged Coordinates
    let evLat = null;
    let evLng = null;

    if (evidenceLatitude !== undefined && evidenceLatitude !== null && evidenceLatitude !== '') {
      evLat = Number(evidenceLatitude);
    } else if (latitude !== undefined && latitude !== null && latitude !== '') {
      evLat = Number(latitude);
    } else if (location && typeof location === 'object' && location.latitude !== undefined && location.latitude !== null && location.latitude !== '') {
      evLat = Number(location.latitude);
    }

    if (evidenceLongitude !== undefined && evidenceLongitude !== null && evidenceLongitude !== '') {
      evLng = Number(evidenceLongitude);
    } else if (longitude !== undefined && longitude !== null && longitude !== '') {
      evLng = Number(longitude);
    } else if (location && typeof location === 'object' && location.longitude !== undefined && location.longitude !== null && location.longitude !== '') {
      evLng = Number(location.longitude);
    }

    if (evLat === null || isNaN(evLat) || evLat < -90 || evLat > 90 || evLng === null || isNaN(evLng) || evLng < -180 || evLng > 180) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        fs.unlinkSync(uploadedFilePath);
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Valid geotagged location coordinates (latitude between -90 and 90, longitude between -180 and 180) are required for the evidence photograph.'
      });
    }

    // 6. Validate Evidence Capture Timestamp
    let capturedDate = new Date();
    if (evidenceCapturedAt) {
      const parsedDate = new Date(evidenceCapturedAt);
      if (isNaN(parsedDate.getTime()) || parsedDate.getTime() > Date.now() + 60000 || parsedDate.getFullYear() < 2000) {
        if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
          fs.unlinkSync(uploadedFilePath);
        }
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Evidence capture timestamp is malformed, in the future, or invalid.'
        });
      }
      capturedDate = parsedDate;
    }

    // Location Accuracy
    let evAccuracy = null;
    if (evidenceAccuracy !== undefined && evidenceAccuracy !== null && evidenceAccuracy !== '') {
      const acc = Number(evidenceAccuracy);
      if (!isNaN(acc) && acc >= 0 && acc <= 100000) {
        evAccuracy = Math.round(acc * 10) / 10;
      }
    }

    // 7. Validate & Normalize Reported Address
    let addressStr = '';
    if (location && typeof location === 'object') {
      addressStr = typeof location.address === 'string' ? location.address.trim() : '';
    } else if (typeof location === 'string') {
      addressStr = location.trim();
    } else if (address && typeof address === 'string') {
      addressStr = address.trim();
    }

    if (!addressStr || addressStr.length < 3) {
      addressStr = `Coordinates: ${evLat.toFixed(4)}, ${evLng.toFixed(4)}`;
    }
    if (addressStr.length > 250) {
      addressStr = addressStr.substring(0, 250);
    }

    // Determine capture provenance
    const resolvedPhotoSource = (photoSource || captureSource || '').toLowerCase();
    const isCameraCapture = resolvedPhotoSource === 'camera';

    let resolvedLocationSource = 'user_confirmed';
    if (evidenceLocationSource === 'exif') {
      resolvedLocationSource = 'exif';
    } else if (evidenceLocationSource === 'user_declared') {
      resolvedLocationSource = 'user_declared';
    } else if (isCameraCapture && evidenceLocationSource === 'device_gps') {
      resolvedLocationSource = 'device_gps';
    } else if (evidenceLocationSource === 'user_confirmed' || !isCameraCapture) {
      resolvedLocationSource = 'user_confirmed';
    } else if (['device_gps', 'user_confirmed', 'user_declared'].includes(evidenceLocationSource)) {
      resolvedLocationSource = evidenceLocationSource;
    }

    // 8. EXIF GPS Analysis & Honest Verification Assessment
    const exif = extractExifGps(fileBuffer);
    let matchResult = 'unavailable';
    let statusVerdict = 'location_captured';
    let reasonVerdict = '';
    let distanceMeters = null;

    if (exif.hasGps) {
      distanceMeters = calculateDistanceMeters(exif.gpsLatitude, exif.gpsLongitude, evLat, evLng);
      if (distanceMeters !== null && distanceMeters <= 200) {
        matchResult = 'matched';
        statusVerdict = 'exif_matched';
        reasonVerdict = `EXIF GPS coordinates match declared location within 200m tolerance (${distanceMeters}m difference).`;
      } else {
        matchResult = 'mismatched';
        statusVerdict = 'location_mismatch';
        reasonVerdict = `EXIF GPS coordinates (${exif.gpsLatitude}, ${exif.gpsLongitude}) differ from declared location by ${distanceMeters}m.`;
      }
    } else {
      matchResult = 'missing';
      statusVerdict = 'exif_missing';
      if (isCameraCapture) {
        reasonVerdict = 'Photograph does not contain embedded EXIF GPS tags. Location recorded via device GPS at camera capture.';
      } else {
        reasonVerdict = 'Photograph does not contain embedded EXIF GPS tags. Location coordinates confirmed by citizen for reported issue.';
      }
    }

    const resolvedExifStatus = exif.hasGps
      ? (matchResult === 'matched' ? 'matched' : 'mismatch')
      : 'no_exif_gps';

    // 9. Generate server-controlled tracking reference
    const trackingId = await Complaint.generateTrackingId();

    // 10. Build and save Complaint
    const assignedPriority = (req.body.priority && ['Low', 'Medium', 'High', 'Urgent'].includes(req.body.priority))
      ? req.body.priority
      : 'Medium';

    const slaDeadlines = calculateSlaDeadlines({
      category: validatedCategory,
      priority: assignedPriority,
      createdAt: new Date()
    });

    const complaint = new Complaint({
      trackingId,
      title: trimmedTitle,
      description: trimmedDescription,
      category: validatedCategory,
      location: {
        address: addressStr,
        latitude: evLat,
        longitude: evLng
      },
      evidence: {
        imageUrl: `/api/complaints/${trackingId}/evidence`,
        storageKey: storageFilename,
        originalFilename: path.basename(originalName).substring(0, 100),
        originalName: path.basename(originalName).substring(0, 100),
        mimetype: detectedMime,
        mimeType: detectedMime,
        size: fileSize,
        sizeBytes: fileSize,
        capturedAt: capturedDate,
        submittedAt: new Date(),
        coordinates: {
          latitude: evLat,
          longitude: evLng,
          accuracy: evAccuracy,
          accuracyMeters: evAccuracy
        },
        locationSource: resolvedLocationSource,
        exifMetadata: {
          hasGps: exif.hasGps,
          gpsLatitude: exif.gpsLatitude,
          gpsLongitude: exif.gpsLongitude,
          matchResult,
          distanceMeters,
          notes: exif.hasGps ? 'GPS coordinates present in EXIF' : 'EXIF GPS tags missing'
        },
        exifComparisonStatus: resolvedExifStatus,
        verificationStatus: statusVerdict,
        verificationReason: reasonVerdict
      },
      priority: assignedPriority,
      sla: {
        policyVersion: slaDeadlines.policyVersion,
        startedAt: slaDeadlines.startedAt,
        acknowledgementDeadline: slaDeadlines.acknowledgementDeadline,
        assignmentDeadline: slaDeadlines.assignmentDeadline,
        resolutionDeadline: slaDeadlines.resolutionDeadline,
        isBreached: false,
        breachedStages: [],
        escalationLevel: 0,
        escalationHistory: [],
        warningNotifiedStages: [],
        breachNotifiedStages: []
      },
      status: 'Submitted',
      citizen: req.user._id,
      statusHistory: [
        {
          status: 'Submitted',
          timestamp: new Date(),
          comment: 'Complaint submitted with mandatory geotagged photo evidence.',
          actor: req.user._id,
          actorRole: 'citizen'
        }
      ]
    });

    await complaint.save();

    return res.status(201).json({
      message: 'Complaint submitted successfully with verified photo evidence',
      complaint: complaint.toSafeObject()
    });
  } catch (error) {
    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      try {
        fs.unlinkSync(uploadedFilePath);
      } catch (cleanupErr) {}
    }
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        error: 'Bad Request',
        message: messages.join(', ')
      });
    }
    next(error);
  }
});

/**
 * @route   GET /api/complaints/my
 * @desc    Get paginated complaints belonging to the authenticated citizen
 * @access  Protected (Authenticated Citizen)
 */
router.get('/my', async (req, res, next) => {
  try {
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    const query = { citizen: req.user._id };

    // Optional status filter
    if (req.query.status && VALID_STATUSES.includes(req.query.status)) {
      query.status = req.query.status;
    }

    // Optional category filter
    if (req.query.category && VALID_CATEGORIES.includes(req.query.category)) {
      query.category = req.query.category;
    }

    // Optional SLA breach filter
    if (req.query.slaBreached === 'true') {
      query['sla.isBreached'] = true;
    }

    // Optional escalation level filter
    if (req.query.escalationLevel !== undefined && ['0', '1', '2', '3'].includes(String(req.query.escalationLevel))) {
      query['sla.escalationLevel'] = parseInt(req.query.escalationLevel, 10);
    }

    // Critical Attention Filter: 'unacknowledged', 'acknowledged', or boolean
    if (req.query.criticalAttention === 'unacknowledged' || req.query.criticalAttention === 'true') {
      query['sla.requiresCriticalAttention'] = true;
    } else if (req.query.criticalAttention === 'acknowledged') {
      query['sla.criticalAttentionAcknowledgedAt'] = { $ne: null };
    }

    // Optional SLA breach filter
    if (req.query.slaBreached === 'true') {
      query['sla.isBreached'] = true;
    }

    // Optional escalation level filter
    if (req.query.escalationLevel !== undefined && ['0', '1', '2', '3'].includes(String(req.query.escalationLevel))) {
      query['sla.escalationLevel'] = parseInt(req.query.escalationLevel, 10);
    }

    // Critical Attention Filter: 'unacknowledged', 'acknowledged', or boolean
    if (req.query.criticalAttention === 'unacknowledged' || req.query.criticalAttention === 'true') {
      query['sla.requiresCriticalAttention'] = true;
    } else if (req.query.criticalAttention === 'acknowledged') {
      query['sla.criticalAttentionAcknowledgedAt'] = { $ne: null };
    }

    // Optional search term on trackingId or title (sanitized against regex injection)
    if (req.query.search && typeof req.query.search === 'string' && req.query.search.trim()) {
      const sanitizedSearch = req.query.search.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const searchRegex = new RegExp(sanitizedSearch, 'i');
      query.$or = [{ trackingId: searchRegex }, { title: searchRegex }];
    }

    const total = await Complaint.countDocuments(query);
    const complaints = await Complaint.find(query)
      .populate('assignedOfficer', 'name department')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.status(200).json({
      complaints: complaints.map((c) => c.toSafeObject()),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/complaints/summary
 * @desc    Get complaint status summary counts for the authenticated citizen
 * @access  Protected (Authenticated Citizen)
 */
router.get('/summary', async (req, res, next) => {
  try {
    const citizenId = req.user._id;

    // Calculate database counts for the citizen
    const [total, submitted, underReview, inProgress, provisionallyResolved, disputed, resolved, rejected] = await Promise.all([
      Complaint.countDocuments({ citizen: citizenId }),
      Complaint.countDocuments({ citizen: citizenId, status: 'Submitted' }),
      Complaint.countDocuments({ citizen: citizenId, status: 'Under Review' }),
      Complaint.countDocuments({ citizen: citizenId, status: 'In Progress' }),
      Complaint.countDocuments({ citizen: citizenId, status: 'Provisionally Resolved' }),
      Complaint.countDocuments({ citizen: citizenId, status: 'Disputed' }),
      Complaint.countDocuments({ citizen: citizenId, status: 'Resolved' }),
      Complaint.countDocuments({ citizen: citizenId, status: 'Rejected' })
    ]);

    return res.status(200).json({
      summary: {
        total,
        submitted,
        underReview,
        inProgress,
        provisionallyResolved,
        disputed,
        resolved,
        rejected
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/complaints/assigned
 * @desc    Get complaints assigned to the authenticated officer
 * @access  Protected (Officer only)
 */
router.get('/assigned', authorize('officer'), async (req, res, next) => {
  try {
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    // Base query: strictly restricted to complaints assigned to this officer
    const query = { assignedOfficer: req.user._id };

    // Optional status filter
    if (req.query.status && VALID_STATUSES.includes(req.query.status)) {
      query.status = req.query.status;
    }

    // Optional category filter
    if (req.query.category && VALID_CATEGORIES.includes(req.query.category)) {
      query.category = req.query.category;
    }

    // Optional SLA breach filter
    if (req.query.slaBreached === 'true') {
      query['sla.isBreached'] = true;
    }

    // Optional escalation level filter
    if (req.query.escalationLevel !== undefined && ['0', '1', '2', '3'].includes(String(req.query.escalationLevel))) {
      query['sla.escalationLevel'] = parseInt(req.query.escalationLevel, 10);
    }

    // Critical Attention Filter: 'unacknowledged', 'acknowledged', or boolean
    if (req.query.criticalAttention === 'unacknowledged' || req.query.criticalAttention === 'true') {
      query['sla.requiresCriticalAttention'] = true;
    } else if (req.query.criticalAttention === 'acknowledged') {
      query['sla.criticalAttentionAcknowledgedAt'] = { $ne: null };
    }

    // Optional SLA breach filter
    if (req.query.slaBreached === 'true') {
      query['sla.isBreached'] = true;
    }

    // Optional escalation level filter
    if (req.query.escalationLevel !== undefined && ['0', '1', '2', '3'].includes(String(req.query.escalationLevel))) {
      query['sla.escalationLevel'] = parseInt(req.query.escalationLevel, 10);
    }

    // Critical Attention Filter: 'unacknowledged', 'acknowledged', or boolean
    if (req.query.criticalAttention === 'unacknowledged' || req.query.criticalAttention === 'true') {
      query['sla.requiresCriticalAttention'] = true;
    } else if (req.query.criticalAttention === 'acknowledged') {
      query['sla.criticalAttentionAcknowledgedAt'] = { $ne: null };
    }

    // Optional search term on trackingId or title (sanitized against regex injection)
    if (req.query.search && typeof req.query.search === 'string' && req.query.search.trim()) {
      const sanitizedSearch = req.query.search.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const searchRegex = new RegExp(sanitizedSearch, 'i');
      query.$or = [{ trackingId: searchRegex }, { title: searchRegex }];
    }

    const total = await Complaint.countDocuments(query);
    const complaints = await Complaint.find(query)
      .populate('citizen', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.status(200).json({
      complaints: complaints.map((c) => ({
        ...c.toSafeObject(req.user),
        citizenName: c.citizen?.name || 'Citizen'
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/complaints/assigned/summary
 * @desc    Get summary status metrics for complaints assigned to the authenticated officer
 * @access  Protected (Officer only)
 */
router.get('/assigned/summary', authorize('officer'), async (req, res, next) => {
  try {
    const officerId = req.user._id;

    const [totalAssigned, submitted, underReview, inProgress, provisionallyResolved, disputed, resolved, rejected] = await Promise.all([
      Complaint.countDocuments({ assignedOfficer: officerId }),
      Complaint.countDocuments({ assignedOfficer: officerId, status: 'Submitted' }),
      Complaint.countDocuments({ assignedOfficer: officerId, status: 'Under Review' }),
      Complaint.countDocuments({ assignedOfficer: officerId, status: 'In Progress' }),
      Complaint.countDocuments({ assignedOfficer: officerId, status: 'Provisionally Resolved' }),
      Complaint.countDocuments({ assignedOfficer: officerId, status: 'Disputed' }),
      Complaint.countDocuments({ assignedOfficer: officerId, status: 'Resolved' }),
      Complaint.countDocuments({ assignedOfficer: officerId, status: 'Rejected' })
    ]);

    return res.status(200).json({
      summary: {
        totalAssigned,
        submitted,
        underReview,
        inProgress,
        provisionallyResolved,
        disputed,
        resolved,
        rejected
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/complaints/admin/summary
 * @desc    Get real, comprehensive city-wide complaint aggregation metrics for administrators
 * @access  Protected (Admin only)
 */
router.get('/admin/summary', authorize('admin'), async (req, res, next) => {
  try {
    const [summaryResult] = await Complaint.aggregate([
      {
        $facet: {
          totalCount: [{ $count: 'count' }],
          statusCounts: [
            { $group: { _id: '$status', count: { $sum: 1 } } }
          ],
          assignmentCounts: [
            {
              $group: {
                _id: { $cond: [{ $ifNull: ['$assignedOfficer', false] }, 'assigned', 'unassigned'] },
                count: { $sum: 1 }
              }
            }
          ],
          departmentCounts: [
            {
              $group: {
                _id: { $ifNull: ['$department', 'Unassigned'] },
                count: { $sum: 1 }
              }
            },
            { $sort: { count: -1 } }
          ],
          categoryCounts: [
            {
              $group: {
                _id: '$category',
                count: { $sum: 1 }
              }
            },
            { $sort: { count: -1 } }
          ],
          priorityCounts: [
            {
              $group: {
                _id: '$priority',
                count: { $sum: 1 }
              }
            }
          ],
          resolutionTimes: [
            {
              $match: {
                status: 'Resolved',
                resolvedAt: { $ne: null }
              }
            },
            {
              $project: {
                durationMs: { $subtract: ['$resolvedAt', '$createdAt'] }
              }
            },
            {
              $match: {
                durationMs: { $gte: 0 }
              }
            },
            {
              $group: {
                _id: null,
                avgDurationMs: { $avg: '$durationMs' },
                count: { $sum: 1 }
              }
            }
          ],
          responseTimes: [
            {
              $project: {
                firstResponse: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: '$statusHistory',
                        as: 'sh',
                        cond: { $ne: ['$$sh.status', 'Submitted'] }
                      }
                    },
                    0
                  ]
                },
                createdAt: 1
              }
            },
            {
              $match: {
                'firstResponse.timestamp': { $exists: true, $ne: null }
              }
            },
            {
              $project: {
                responseDurationMs: {
                  $subtract: ['$firstResponse.timestamp', '$createdAt']
                }
              }
            },
            {
              $match: {
                responseDurationMs: { $gte: 0 }
              }
            },
            {
              $group: {
                _id: null,
                avgResponseMs: { $avg: '$responseDurationMs' },
                count: { $sum: 1 }
              }
            }
          ]
        }
      }
    ]);

    const total = summaryResult?.totalCount?.[0]?.count || 0;

    // Build status breakdown map with guaranteed keys
    const byStatus = {
      'Submitted': 0,
      'Under Review': 0,
      'In Progress': 0,
      'Provisionally Resolved': 0,
      'Disputed': 0,
      'Resolved': 0,
      'Rejected': 0
    };
    (summaryResult?.statusCounts || []).forEach((item) => {
      if (Object.prototype.hasOwnProperty.call(byStatus, item._id)) {
        byStatus[item._id] = item.count;
      }
    });

    // Build assignment counts
    let unassigned = 0;
    let assigned = 0;
    (summaryResult?.assignmentCounts || []).forEach((item) => {
      if (item._id === 'unassigned') unassigned = item.count;
      if (item._id === 'assigned') assigned = item.count;
    });

    // Build category map
    const byCategory = {};
    VALID_CATEGORIES.forEach((cat) => {
      byCategory[cat] = 0;
    });
    (summaryResult?.categoryCounts || []).forEach((item) => {
      byCategory[item._id] = item.count;
    });

    // Build department breakdown map
    const byDepartment = {};
    (summaryResult?.departmentCounts || []).forEach((item) => {
      byDepartment[item._id] = item.count;
    });

    // Resolution and Response timing metrics
    const resolutionData = summaryResult?.resolutionTimes?.[0];
    const responseData = summaryResult?.responseTimes?.[0];

    const avgResolutionHours = resolutionData && resolutionData.count > 0
      ? Number((resolutionData.avgDurationMs / (1000 * 60 * 60)).toFixed(1))
      : null;

    const avgResponseHours = responseData && responseData.count > 0
      ? Number((responseData.avgResponseMs / (1000 * 60 * 60)).toFixed(1))
      : null;

    return res.status(200).json({
      summary: {
        total,
        byStatus,
        unassigned,
        assigned,
        resolved: byStatus['Resolved'],
        rejected: byStatus['Rejected'],
        activeIssues: byStatus['Submitted'] + byStatus['Under Review'] + byStatus['In Progress'] + byStatus['Provisionally Resolved'] + byStatus['Disputed'],
        byCategory,
        byDepartment,
        performance: {
          avgResolutionHours,
          resolvedCount: resolutionData?.count || 0,
          avgResponseHours,
          respondedCount: responseData?.count || 0,
          slaStatus: 'unavailable',
          slaNotice: 'Overdue tracking requires a municipal SLA policy defining resolution timeframes by priority and category.'
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/complaints/admin/officer-workload
 * @desc    Get real-time workload metrics for all municipal officers
 * @access  Protected (Admin only)
 */
router.get('/admin/officer-workload', authorize('admin'), async (req, res, next) => {
  try {
    const officers = await User.find({ role: 'officer' })
      .select('name email department createdAt')
      .sort({ name: 1 })
      .lean();

    const officerIds = officers.map((o) => o._id);

    // Aggregate workloads for all officers in a single aggregation
    const workloads = await Complaint.aggregate([
      {
        $match: {
          assignedOfficer: { $in: officerIds }
        }
      },
      {
        $group: {
          _id: '$assignedOfficer',
          totalAssigned: { $sum: 1 },
          submitted: { $sum: { $cond: [{ $eq: ['$status', 'Submitted'] }, 1, 0] } },
          underReview: { $sum: { $cond: [{ $eq: ['$status', 'Under Review'] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ['$status', 'In Progress'] }, 1, 0] } },
          resolved: { $sum: { $cond: [{ $eq: ['$status', 'Resolved'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'Rejected'] }, 1, 0] } }
        }
      }
    ]);

    const workloadMap = new Map();
    workloads.forEach((w) => {
      workloadMap.set(w._id.toString(), {
        totalAssigned: w.totalAssigned || 0,
        active: (w.underReview || 0) + (w.inProgress || 0),
        underReview: w.underReview || 0,
        inProgress: w.inProgress || 0,
        resolved: w.resolved || 0,
        rejected: w.rejected || 0
      });
    });

    const officersWithWorkload = officers.map((officer) => {
      const metrics = workloadMap.get(officer._id.toString()) || {
        totalAssigned: 0,
        active: 0,
        underReview: 0,
        inProgress: 0,
        resolved: 0,
        rejected: 0
      };

      return {
        id: officer._id,
        name: officer.name,
        email: officer.email,
        department: officer.department || 'General Municipal Operations',
        joinedAt: officer.createdAt,
        metrics
      };
    });

    const totalAssignedTasks = workloads.reduce((acc, curr) => acc + (curr.totalAssigned || 0), 0);

    return res.status(200).json({
      officers: officersWithWorkload,
      totalOfficers: officersWithWorkload.length,
      totalAssignedTasks
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/complaints/admin/all
 * @desc    Get paginated complaints for administrative assignment and oversight
 * @access  Protected (Admin only)
 */
router.get('/admin/all', authorize('admin'), async (req, res, next) => {
  try {
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    const query = {};

    // Filter unassigned only
    if (req.query.unassigned === 'true') {
      query.assignedOfficer = null;
    }

    if (req.query.status && VALID_STATUSES.includes(req.query.status)) {
      query.status = req.query.status;
    }

    if (req.query.category && VALID_CATEGORIES.includes(req.query.category)) {
      query.category = req.query.category;
    }

    // Optional SLA breach filter
    if (req.query.slaBreached === 'true') {
      query['sla.isBreached'] = true;
    }

    // Optional escalation level filter
    if (req.query.escalationLevel !== undefined && ['0', '1', '2', '3'].includes(String(req.query.escalationLevel))) {
      query['sla.escalationLevel'] = parseInt(req.query.escalationLevel, 10);
    }

    // Critical Attention Filter: 'unacknowledged', 'acknowledged', or boolean
    if (req.query.criticalAttention === 'unacknowledged' || req.query.criticalAttention === 'true') {
      query['sla.requiresCriticalAttention'] = true;
    } else if (req.query.criticalAttention === 'acknowledged') {
      query['sla.criticalAttentionAcknowledgedAt'] = { $ne: null };
    }

    const total = await Complaint.countDocuments(query);
    const complaints = await Complaint.find(query)
      .populate('citizen', 'name email')
      .populate('assignedOfficer', 'name email department')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.status(200).json({
      complaints: complaints.map((c) => ({
        ...c.toSafeObject(req.user),
        citizenName: c.citizen?.name || 'Citizen',
        officerName: c.assignedOfficer?.name || null,
        officerEmail: c.assignedOfficer?.email || null
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/complaints/admin/officers
 * @desc    List available municipal officers for assignment
 * @access  Protected (Admin only)
 */
router.get('/admin/officers', authorize('admin'), async (req, res, next) => {
  try {
    const officers = await User.find({ role: 'officer' })
      .select('name email department')
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({
      officers: officers.map((o) => ({
        id: o._id,
        name: o.name,
        email: o.email,
        department: o.department || 'General Municipal Operations'
      }))
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/complaints/export/csv
 * @desc    Export filtered complaints to CSV with formula injection defense
 * @access  Protected (Role-scoped: citizen=own, officer=assigned, admin=all)
 */
router.get('/export/csv', async (req, res, next) => {
  try {
    const query = {};

    // Role-based scoping
    if (req.user.role === 'citizen') {
      query.citizen = req.user._id;
    } else if (req.user.role === 'officer') {
      query.assignedOfficer = req.user._id;
    }
    // Admin has access to all records

    // Filters
    const { status, category, department, startDate, endDate, assigned, officerId } = req.query;

    if (status && VALID_STATUSES.includes(status)) {
      query.status = status;
    }

    if (category && VALID_CATEGORIES.includes(category)) {
      query.category = category;
    }

    if (department && typeof department === 'string' && department.trim()) {
      query.department = department.trim();
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) {
          query.createdAt.$gte = start;
        }
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          query.createdAt.$lte = end;
        }
      }
      if (Object.keys(query.createdAt).length === 0) {
        delete query.createdAt;
      }
    }

    if (req.user.role === 'admin') {
      if (assigned === 'true') {
        query.assignedOfficer = { $ne: null };
      } else if (assigned === 'false') {
        query.assignedOfficer = null;
      }

      if (officerId && mongoose.Types.ObjectId.isValid(officerId)) {
        query.assignedOfficer = officerId;
      }
    }

    // Limit to 5000 records to protect memory
    const complaints = await Complaint.find(query)
      .sort({ createdAt: -1 })
      .limit(5000)
      .populate('assignedOfficer', 'name email department')
      .populate('citizen', 'name email')
      .lean();

    // CSV Formula Injection Sanitizer
    const sanitizeCsvCell = (val) => {
      if (val === null || val === undefined) return '""';
      let str = String(val);
      // Defense: If value starts with =, +, -, @, \t, \r, prepend single quote '
      if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
      }
      str = str.replace(/"/g, '""');
      return `"${str}"`;
    };

    const headers = [
      'Tracking ID',
      'Title',
      'Description',
      'Category',
      'Status',
      'Priority',
      'Department',
      'Location Address',
      'Latitude',
      'Longitude',
      'Evidence Status',
      'Assigned Officer',
      'Created At',
      'Resolved At',
      'Resolution Notes'
    ];

    const rows = [headers.join(',')];

    for (const c of complaints) {
      const row = [
        sanitizeCsvCell(c.trackingId),
        sanitizeCsvCell(c.title),
        sanitizeCsvCell(c.description || ''),
        sanitizeCsvCell(c.category),
        sanitizeCsvCell(c.status),
        sanitizeCsvCell(c.priority),
        sanitizeCsvCell(c.department || 'Unassigned'),
        sanitizeCsvCell(c.location?.address || ''),
        sanitizeCsvCell(c.location?.latitude ?? c.evidence?.coordinates?.latitude ?? ''),
        sanitizeCsvCell(c.location?.longitude ?? c.evidence?.coordinates?.longitude ?? ''),
        sanitizeCsvCell(c.evidence?.verificationStatus || 'No Evidence'),
        sanitizeCsvCell(c.assignedOfficer?.name || 'Unassigned'),
        sanitizeCsvCell(c.createdAt ? new Date(c.createdAt).toISOString() : ''),
        sanitizeCsvCell(c.resolvedAt ? new Date(c.resolvedAt).toISOString() : ''),
        sanitizeCsvCell(c.resolutionNotes || '')
      ];
      rows.push(row.join(','));
    }

    const csvContent = rows.join('\r\n');
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `civictrack-complaints-${today}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csvContent);
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/complaints/ai-assist
 * @desc    AI-assisted category classification, priority recommendation, and duplicate detection
 * @access  Protected (All authenticated roles)
 */
router.post('/ai-assist', async (req, res, next) => {
  try {
    const { title, description, category, coordinates } = req.body;

    // Validate input presence and length
    if (!title || typeof title !== 'string' || title.trim().length < 3) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'A complaint title with at least 3 characters is required for AI classification.'
      });
    }

    if (title.trim().length > 250) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Complaint title cannot exceed 250 characters.'
      });
    }

    if (description && typeof description === 'string' && description.length > 3000) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Complaint description cannot exceed 3000 characters.'
      });
    }

    // Coordinate validation if provided
    let safeCoords = null;
    if (coordinates && typeof coordinates === 'object') {
      const lat = Number(coordinates.latitude);
      const lng = Number(coordinates.longitude);
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        safeCoords = { latitude: lat, longitude: lng };
      }
    }

    // Run dual-engine classification & priority recommendation
    const aiAnalysis = await analyzeComplaint({
      title: title.trim(),
      description: (description || '').trim(),
      coordinates: safeCoords
    });

    // Run potential duplicate detection
    const potentialDuplicates = await findPotentialDuplicates(Complaint, {
      title: title.trim(),
      category: category || aiAnalysis.category,
      coordinates: safeCoords
    });

    return res.status(200).json({
      categoryRecommendation: {
        category: aiAnalysis.category,
        confidence: aiAnalysis.confidence,
        reasoning: aiAnalysis.categoryReasoning
      },
      priorityRecommendation: {
        priority: aiAnalysis.priority,
        rationale: aiAnalysis.priorityRationale,
        isOfficial: false
      },
      potentialDuplicates,
      meta: {
        provider: aiAnalysis.provider,
        model: aiAnalysis.model,
        evaluatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    // Graceful fallback on unexpected error: never block submission
    console.warn('[AI Route] Error during AI assist:', error.message);
    return res.status(200).json({
      categoryRecommendation: {
        category: 'Other',
        confidence: 0.2,
        reasoning: 'Automated analysis unavailable. Please select the most appropriate category manually.'
      },
      priorityRecommendation: {
        priority: 'Medium',
        rationale: 'Standard municipal priority baseline. Official priority assigned upon review.',
        isOfficial: false
      },
      potentialDuplicates: [],
      meta: {
        provider: 'fallback',
        model: 'none',
        evaluatedAt: new Date().toISOString(),
        errorNotice: 'AI service temporarily in fallback mode'
      }
    });
  }
});

/**
 * @route   GET /api/complaints/track/:trackingId
 * @desc    Track a complaint by public tracking reference
 * @access  Protected (Citizen can track own; Officer can track assigned; Admin can track any)
 */
router.get('/track/:trackingId', async (req, res, next) => {
  try {
    const rawTrackingId = req.params.trackingId;
    if (!rawTrackingId || typeof rawTrackingId !== 'string') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Tracking ID is required.'
      });
    }

    const normalizedTrackingId = rawTrackingId.trim().toUpperCase();

    // Query condition based on authenticated role
    const query = { trackingId: normalizedTrackingId };
    if (req.user) {
      if (req.user.role === 'citizen') {
        query.citizen = req.user._id;
      } else if (req.user.role === 'officer') {
        query.assignedOfficer = req.user._id;
      }
      // Admin has unrestricted read access
    }

    const complaint = await Complaint.findOne(query)
      .populate('citizen', 'name email')
      .populate('assignedOfficer', 'name email department');

    if (!complaint) {
      return res.status(404).json({
        error: 'Not Found',
        message: `No complaint found with tracking reference '${normalizedTrackingId}'.`
      });
    }

    return res.status(200).json({
      complaint: complaint.toSafeObject(req.user)
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/complaints/:id
 * @desc    Get detailed complaint by ID
 * @access  Protected (Citizen: own; Officer: assigned; Admin: any)
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid complaint ID format.'
      });
    }

    const complaint = await Complaint.findById(id)
      .populate('citizen', 'name email')
      .populate('assignedOfficer', 'name email department');

    if (!complaint) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Complaint not found.'
      });
    }

    // Role-based authorization check
    if (req.user.role === 'citizen') {
      if (!complaint.citizen._id.equals(req.user._id)) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Complaint not found.'
        });
      }
    } else if (req.user.role === 'officer') {
      if (!complaint.assignedOfficer || !complaint.assignedOfficer._id.equals(req.user._id)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied. You are only authorized to view complaints explicitly assigned to you.'
        });
      }
    }
    // Admin is authorized to view all

    return res.status(200).json({
      complaint: complaint.toSafeObject(req.user)
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/complaints/:id/evidence
 * @desc    Stream the authenticated issue photograph evidence
 * @access  Protected (Owner Citizen, Assigned Officer, or Admin)
 */
router.get('/:id/evidence', async (req, res, next) => {
  try {
    const { id } = req.params;

    const complaint = mongoose.Types.ObjectId.isValid(id)
      ? await Complaint.findById(id)
      : await Complaint.findOne({ trackingId: id.trim().toUpperCase() });

    if (!complaint) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Complaint not found.'
      });
    }

    if (!complaint.evidence || !complaint.evidence.storageKey) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No evidence photograph on record for this complaint.'
      });
    }

    // Role-based authorization
    const isAdmin = req.user.role === 'admin';
    const isOwner = complaint.citizen && complaint.citizen.equals(req.user._id);
    const isAssignedOfficer =
      req.user.role === 'officer' &&
      complaint.assignedOfficer &&
      complaint.assignedOfficer.equals(req.user._id);

    if (!isAdmin && !isOwner && !isAssignedOfficer) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied. You are not authorized to view evidence for this complaint.'
      });
    }

    const resolvedUploadDir = path.resolve(UPLOAD_DIR);
    const rawKey = complaint.evidence.storageKey;
    if (!rawKey || typeof rawKey !== 'string') {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No evidence photograph on record for this complaint.'
      });
    }

    const candidatePath = path.resolve(resolvedUploadDir, rawKey);
    if (!isPathInsideDirectory(resolvedUploadDir, candidatePath)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied. Evidence path outside designated evidence directory.'
      });
    }

    const safeKey = path.basename(rawKey);
    let fileBuffer;
    try {
      fileBuffer = await storageService.getFileBuffer(safeKey);
    } catch (storageErr) {
      if (storageErr.isNotFound || storageErr.statusCode === 404 || (storageErr.message && storageErr.message.includes('Object not found'))) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Evidence photograph file is missing from server storage.'
        });
      }
      res.setHeader('Retry-After', '30');
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Evidence storage service is temporarily unreachable. Please retry shortly.'
      });
    }

    res.setHeader('Content-Type', complaint.evidence.mimetype || 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename="${safeKey}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(200).send(fileBuffer);
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/complaints/:id/completion-evidence
 * @desc    Stream the authenticated completion photograph evidence
 * @access  Protected (Owner Citizen, Assigned Officer, or Admin)
 */
router.get('/:id/completion-evidence', async (req, res, next) => {
  try {
    const { id } = req.params;

    const complaint = mongoose.Types.ObjectId.isValid(id)
      ? await Complaint.findById(id)
      : await Complaint.findOne({ trackingId: id.trim().toUpperCase() });

    if (!complaint) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Complaint not found.'
      });
    }

    if (!complaint.completionEvidence || !complaint.completionEvidence.storageKey) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No completion evidence photograph on record for this complaint.'
      });
    }

    // Role-based authorization: Owner Citizen, Assigned Officer, or Admin
    const isAdmin = req.user.role === 'admin';
    const isOwner = complaint.citizen && complaint.citizen.equals(req.user._id);
    const isAssignedOfficer =
      req.user.role === 'officer' &&
      complaint.assignedOfficer &&
      complaint.assignedOfficer.equals(req.user._id);

    if (!isAdmin && !isOwner && !isAssignedOfficer) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied. You are not authorized to view completion evidence for this complaint.'
      });
    }

    const resolvedUploadDir = path.resolve(UPLOAD_DIR);
    const rawKey = complaint.completionEvidence.storageKey;
    if (!rawKey || typeof rawKey !== 'string') {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No completion evidence photograph on record for this complaint.'
      });
    }

    const candidatePath = path.resolve(resolvedUploadDir, rawKey);
    if (!isPathInsideDirectory(resolvedUploadDir, candidatePath)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied. Completion evidence path outside designated evidence directory.'
      });
    }

    const safeKey = path.basename(rawKey);
    let fileBuffer;
    try {
      fileBuffer = await storageService.getFileBuffer(safeKey);
    } catch (storageErr) {
      if (storageErr.isNotFound || storageErr.statusCode === 404 || (storageErr.message && storageErr.message.includes('Object not found'))) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Completion evidence photograph file is missing from server storage.'
        });
      }
      res.setHeader('Retry-After', '30');
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Evidence storage service is temporarily unreachable. Please retry shortly.'
      });
    }

    res.setHeader('Content-Type', complaint.completionEvidence.mimetype || complaint.completionEvidence.mimeType || 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename="${safeKey}"`);
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.status(200).send(fileBuffer);
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/complaints/:id/dispute-evidence
 * @desc    Stream the authenticated dispute photograph evidence
 * @access  Protected (Owner Citizen, Assigned Officer, or Admin)
 */
router.get('/:id/dispute-evidence', async (req, res, next) => {
  try {
    const { id } = req.params;

    const complaint = mongoose.Types.ObjectId.isValid(id)
      ? await Complaint.findById(id)
      : await Complaint.findOne({ trackingId: id.trim().toUpperCase() });

    if (!complaint) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Complaint not found.'
      });
    }

    if (!complaint.resolutionDispute || !complaint.resolutionDispute.photo || !complaint.resolutionDispute.photo.storageKey) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No dispute evidence photograph on record for this complaint.'
      });
    }

    // Role-based authorization: Owner Citizen, Assigned Officer, or Admin
    const isAdmin = req.user.role === 'admin';
    const isOwner = complaint.citizen && complaint.citizen.equals(req.user._id);
    const isAssignedOfficer =
      req.user.role === 'officer' &&
      complaint.assignedOfficer &&
      complaint.assignedOfficer.equals(req.user._id);

    if (!isAdmin && !isOwner && !isAssignedOfficer) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied. You are not authorized to view dispute evidence for this complaint.'
      });
    }

    const resolvedUploadDir = path.resolve(UPLOAD_DIR);
    const rawKey = complaint.resolutionDispute.photo.storageKey;
    if (!rawKey || typeof rawKey !== 'string') {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No dispute evidence photograph on record for this complaint.'
      });
    }

    const candidatePath = path.resolve(resolvedUploadDir, rawKey);
    if (!isPathInsideDirectory(resolvedUploadDir, candidatePath)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied. Dispute evidence path outside designated evidence directory.'
      });
    }

    const safeKey = path.basename(rawKey);
    let fileBuffer;
    try {
      fileBuffer = await storageService.getFileBuffer(safeKey);
    } catch (storageErr) {
      if (storageErr.isNotFound || storageErr.statusCode === 404 || (storageErr.message && storageErr.message.includes('Object not found'))) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Dispute evidence photograph file is missing from server storage.'
        });
      }
      res.setHeader('Retry-After', '30');
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Evidence storage service is temporarily unreachable. Please retry shortly.'
      });
    }

    res.setHeader('Content-Type', complaint.resolutionDispute.photo.mimeType || 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename="${safeKey}"`);
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.status(200).send(fileBuffer);
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/complaints/:id/complete-work
 * @desc    Submit geo-verified work completion evidence by assigned officer
 * @access  Protected (Assigned Officer only)
 */
router.post('/:id/complete-work', authorize('officer'), handleCompletionUpload, async (req, res, next) => {
  let uploadedFilePath = req.file ? req.file.path : null;

  try {
    const { id } = req.params;

    // 1. Complaint Lookup
    const complaint = mongoose.Types.ObjectId.isValid(id)
      ? await Complaint.findById(id)
      : await Complaint.findOne({ trackingId: id.trim().toUpperCase() });

    if (!complaint) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(404).json({
        error: 'Not Found',
        message: 'Complaint not found.'
      });
    }

    // 2. Assignment Authorization Check
    if (!complaint.assignedOfficer || !complaint.assignedOfficer.equals(req.user._id)) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied. You are not assigned to this complaint.'
      });
    }

    // 3. Status Check: must be 'In Progress'
    if (complaint.status !== 'In Progress') {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: `Cannot submit completion evidence. Complaint status must be 'In Progress' (current status: '${complaint.status}').`
      });
    }

    // 4. Validate Resolution Notes (10 - 2000 characters)
    const { resolutionNotes, latitude, longitude, accuracy, capturedAt, completionPhotoBase64, photoBase64 } = req.body;

    if (!resolutionNotes || typeof resolutionNotes !== 'string' || resolutionNotes.trim().length < 10) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Resolution notes are required and must be at least 10 characters long.'
      });
    }

    if (resolutionNotes.trim().length > 2000) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Resolution notes cannot exceed 2000 characters.'
      });
    }

    // 5. Validate Device Coordinates
    if (latitude === undefined || latitude === null || latitude === '' || isNaN(Number(latitude))) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Valid GPS latitude between -90 and 90 is required.'
      });
    }
    const latNum = Number(latitude);
    if (latNum < -90 || latNum > 90) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'GPS latitude must be between -90 and 90 degrees.'
      });
    }

    if (longitude === undefined || longitude === null || longitude === '' || isNaN(Number(longitude))) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Valid GPS longitude between -180 and 180 is required.'
      });
    }
    const lngNum = Number(longitude);
    if (lngNum < -180 || lngNum > 180) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'GPS longitude must be between -180 and 180 degrees.'
      });
    }

    // 6. Validate Accuracy (finite, positive, <= 100 meters)
    if (accuracy === undefined || accuracy === null || accuracy === '' || isNaN(Number(accuracy))) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Valid GPS accuracy in metres is required.'
      });
    }
    const accNum = Number(accuracy);
    if (!isFinite(accNum) || accNum <= 0) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'GPS accuracy must be a positive finite number.'
      });
    }
    if (accNum > 100) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: `GPS accuracy is insufficient (${accNum}m). Accuracy of 100 metres or better is required.`
      });
    }

    // 7. Validate Capture Timestamp (valid, not >60s future, not >24h old)
    if (!capturedAt) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Capture timestamp (capturedAt) is required.'
      });
    }
    const captureDate = new Date(capturedAt);
    const timeVal = captureDate.getTime();
    if (isNaN(timeVal)) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Capture timestamp (capturedAt) is invalid or malformed.'
      });
    }
    const now = Date.now();
    if (timeVal > now + 60 * 1000) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Capture timestamp cannot be in the future (exceeds permitted clock skew of 60 seconds).'
      });
    }
    if (timeVal < now - 24 * 60 * 60 * 1000) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Capture timestamp cannot be older than 24 hours.'
      });
    }

    // 8. Validate Mandatory Completion Photograph
    // Reject Base64 uploads on work completion endpoint (enforce multipart-only contract)
    if (
      completionPhotoBase64 ||
      photoBase64 ||
      (typeof req.body.completionPhoto === 'string' && req.body.completionPhoto.startsWith('data:image/')) ||
      (typeof req.body.photo === 'string' && req.body.photo.startsWith('data:image/'))
    ) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: "Base64 photograph submissions are not permitted for work completion. A mandatory multipart 'completionPhoto' file must be uploaded."
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: 'Bad Request',
        message: "Completion photograph is required. Please capture or upload a multipart image file using field name 'completionPhoto'."
      });
    }

    let fileBuffer = fs.readFileSync(req.file.path);
    let storageFilename = req.file.filename;
    let originalName = req.file.originalname;
    let fileMime = req.file.mimetype;
    let fileSize = req.file.size;

    // Check size <= 10MB
    if (fileSize > 10 * 1024 * 1024) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Uploaded completion photograph exceeds the maximum permitted size of 10MB.'
      });
    }

    // Check magic bytes
    const detectedMime = validateImageMagicBytes(fileBuffer);
    if (!detectedMime) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Uploaded file is not a valid image format (genuine JPEG, PNG, or WebP required).'
      });
    }

    // 9. Duplicate Image Content Check (SHA-256)
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    if (complaint.evidence?.storageKey) {
      const origSafeKey = path.basename(complaint.evidence.storageKey);
      const origPath = path.resolve(UPLOAD_DIR, origSafeKey);
      if (fs.existsSync(origPath)) {
        try {
          const origBuffer = fs.readFileSync(origPath);
          const origHash = crypto.createHash('sha256').update(origBuffer).digest('hex');
          if (origHash === fileHash) {
            if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
              try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
            }
            return res.status(400).json({
              error: 'Bad Request',
              message: 'Completion photograph matches the original complaint photograph. A genuine photo of completed work is required.'
            });
          }
        } catch (e) {
          // non-blocking
        }
      }
    }

    // 10. Check Original Complaint GPS Coordinates
    const origLat = complaint.location?.latitude;
    const origLng = complaint.location?.longitude;
    const hasOrigCoords =
      origLat !== null &&
      origLat !== undefined &&
      typeof origLat === 'number' &&
      !isNaN(origLat) &&
      origLng !== null &&
      origLng !== undefined &&
      typeof origLng === 'number' &&
      !isNaN(origLng);

    if (!hasOrigCoords) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Original complaint does not contain valid GPS coordinates. Distance verification cannot be performed.'
      });
    }

    // 11. Distance Verification
    const toleranceMeters = process.env.COMPLETION_GPS_TOLERANCE_METERS
      ? parseInt(process.env.COMPLETION_GPS_TOLERANCE_METERS, 10)
      : 200;

    const distanceMeters = calculateDistanceMeters(Number(origLat), Number(origLng), latNum, lngNum);
    if (distanceMeters === null || distanceMeters > toleranceMeters) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: `Completion location is ${distanceMeters}m away from the original complaint location, which exceeds the permitted tolerance of ${toleranceMeters}m.`
      });
    }

    // 12. EXIF GPS Extraction & Analysis
    const exif = extractExifGps(fileBuffer);
    let exifComparisonStatus = 'no_metadata';
    let verificationStatus = 'verified';
    let verificationReason = `Device GPS verified within ${distanceMeters}m of original complaint location (tolerance: ${toleranceMeters}m, GPS accuracy: ${accNum}m).`;

    let exifMetadata = {
      hasGps: false,
      gpsLatitude: null,
      gpsLongitude: null,
      matchResult: 'unavailable',
      distanceMeters: null,
      notes: 'No embedded EXIF GPS metadata found in uploaded image; relying on device GPS.'
    };

    if (exif.hasGps && exif.gpsLatitude !== null && exif.gpsLongitude !== null) {
      exifMetadata.hasGps = true;
      exifMetadata.gpsLatitude = exif.gpsLatitude;
      exifMetadata.gpsLongitude = exif.gpsLongitude;

      const exifDistToDevice = calculateDistanceMeters(latNum, lngNum, exif.gpsLatitude, exif.gpsLongitude);
      exifMetadata.distanceMeters = exifDistToDevice;

      if (exifDistToDevice !== null && exifDistToDevice > 150) {
        exifComparisonStatus = 'location_mismatch';
        verificationStatus = 'warning';
        exifMetadata.matchResult = 'mismatched';
        exifMetadata.notes = `EXIF GPS coordinates differ by ${exifDistToDevice}m from submitted device GPS (threshold: 150m).`;
        verificationReason = `Telemetry warning: EXIF GPS coordinates differ by ${exifDistToDevice}m from submitted device GPS. Evidence recorded with verification warning.`;
      } else {
        exifComparisonStatus = 'verified';
        verificationStatus = 'verified';
        exifMetadata.matchResult = 'matched';
        exifMetadata.notes = `EXIF GPS matched device GPS (within ${exifDistToDevice || 0}m).`;
        verificationReason += ` EXIF GPS matched device GPS (within ${exifDistToDevice || 0}m).`;
      }
    }

    // 13. Construct Completion Evidence Object
    const completionEvidenceData = {
      imageUrl: `/api/complaints/${complaint._id}/completion-evidence`,
      storageKey: storageFilename,
      originalFilename: originalName,
      originalName: originalName,
      mimetype: detectedMime,
      mimeType: detectedMime,
      size: fileSize,
      sizeBytes: fileSize,
      capturedAt: captureDate,
      submittedAt: new Date(),
      coordinates: {
        latitude: latNum,
        longitude: lngNum,
        accuracy: accNum,
        accuracyMeters: accNum
      },
      locationSource: exif.hasGps ? 'exif' : 'device_gps',
      resolutionNotes: resolutionNotes.trim(),
      exifMetadata: exifMetadata,
      exifComparisonStatus: exifComparisonStatus,
      distanceMeters: distanceMeters,
      verificationStatus: verificationStatus,
      verificationReason: verificationReason
    };

    // 14. Atomic State Transition (prevent concurrent double-completions)
    const updatedComplaint = await Complaint.findOneAndUpdate(
      {
        _id: complaint._id,
        status: 'In Progress'
      },
      {
        $set: {
          status: 'Provisionally Resolved',
          completionEvidence: completionEvidenceData,
          resolutionNotes: resolutionNotes.trim(),
          'sla.provisionallyResolvedAt': new Date()
        },
        $push: {
          statusHistory: {
            status: 'Provisionally Resolved',
            timestamp: new Date(),
            comment: `Work completed by officer. Geo-verified within ${distanceMeters}m (tolerance: ${toleranceMeters}m). Notes: ${resolutionNotes.trim().slice(0, 150)}`,
            actor: req.user._id,
            actorRole: 'officer'
          }
        }
      },
      { new: true, runValidators: true }
    );

    if (!updatedComplaint) {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try { fs.unlinkSync(uploadedFilePath); } catch (e) {}
      }
      return res.status(409).json({
        error: 'Conflict',
        message: 'Complaint is no longer in progress or was concurrently updated by another process.'
      });
    }

    // 15. Send Notification to Citizen
    await sendNotification({
      recipient: updatedComplaint.citizen,
      actor: req.user._id,
      actorRole: 'officer',
      complaint: updatedComplaint._id,
      trackingId: updatedComplaint.trackingId,
      type: 'work_completed',
      title: 'Work Completed on Your Complaint',
      message: `Officer ${req.user.name} has submitted completion evidence for "${updatedComplaint.title}". Please review and confirm the resolution.`
    });

    return res.status(200).json({
      message: 'Work completion evidence submitted successfully. Complaint is now provisionally resolved.',
      complaint: updatedComplaint.toSafeObject(req.user)
    });
  } catch (error) {
    cleanupUploadedFiles(req);
    next(error);
  }
});

/**
 * @route   PATCH /api/complaints/:id/confirm-resolution
 * @desc    Citizen confirms satisfactory work completion, transitioning status to final 'Resolved'
 * @access  Protected (Complaint Owner Citizen only)
 */
router.patch('/:id/confirm-resolution', authorize('citizen'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const complaint = mongoose.Types.ObjectId.isValid(id)
      ? await Complaint.findById(id)
      : await Complaint.findOne({ trackingId: id.trim().toUpperCase() });

    if (!complaint) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Complaint not found.'
      });
    }

    // Role & Ownership Authorization Guard
    if (!complaint.citizen || !complaint.citizen.equals(req.user._id)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied. You are only authorized to confirm resolution for complaints filed by your account.'
      });
    }

    // Lifecycle Status Precondition Guard
    if (complaint.status !== 'Provisionally Resolved') {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Cannot confirm resolution. Complaint is currently in '${complaint.status}' status (must be 'Provisionally Resolved').`
      });
    }

    const now = new Date();
    const resDeadline = complaint.sla?.resolutionDeadline ? new Date(complaint.sla.resolutionDeadline) : null;
    const isWithinSla = resDeadline ? (now <= resDeadline) : true;
    const startMs = complaint.sla?.startedAt ? new Date(complaint.sla.startedAt).getTime() : new Date(complaint.createdAt).getTime();
    const durationMs = now.getTime() - startMs;

    // Atomic Status Transition
    const updatedComplaint = await Complaint.findOneAndUpdate(
      {
        _id: complaint._id,
        status: 'Provisionally Resolved'
      },
      {
        $set: {
          status: 'Resolved',
          resolvedAt: now,
          'sla.isResolvedWithinSla': isWithinSla,
          'sla.totalResolutionDurationMs': durationMs
        },
        $push: {
          statusHistory: {
            status: 'Resolved',
            timestamp: new Date(),
            comment: 'Citizen confirmed satisfactory resolution of civic work.',
            actor: req.user._id,
            actorRole: 'citizen'
          }
        }
      },
      { new: true, runValidators: true }
    );

    if (!updatedComplaint) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Complaint is no longer in provisionally resolved status or was concurrently modified by another process.'
      });
    }

    // Send In-App Notifications
    if (updatedComplaint.assignedOfficer) {
      await sendNotification({
        recipient: updatedComplaint.assignedOfficer,
        actor: req.user._id,
        actorRole: 'citizen',
        complaint: updatedComplaint._id,
        trackingId: updatedComplaint.trackingId,
        type: 'resolution_confirmed',
        title: 'Resolution Confirmed by Citizen',
        message: `Citizen ${req.user.name} has confirmed the satisfactory resolution of complaint "${updatedComplaint.title}" (${updatedComplaint.trackingId}).`
      });
    }

    await sendNotification({
      recipient: updatedComplaint.citizen,
      actor: req.user._id,
      actorRole: 'citizen',
      complaint: updatedComplaint._id,
      trackingId: updatedComplaint.trackingId,
      type: 'complaint_resolved',
      title: 'Complaint Resolved',
      message: `You have confirmed satisfactory resolution for complaint "${updatedComplaint.title}" (${updatedComplaint.trackingId}). Thank you for helping keep our city clean and safe!`
    });

    return res.status(200).json({
      message: 'Complaint resolution confirmed successfully. Complaint is now resolved.',
      complaint: updatedComplaint.toSafeObject(req.user)
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/complaints/:id/dispute
 * @desc    Citizen disputes provisional resolution with mandatory reason and optional photographic evidence
 * @access  Protected (Complaint Owner Citizen only)
 */
router.post('/:id/dispute', authorize('citizen'), handleDisputeUpload, async (req, res, next) => {
  let uploadedFilePath = req.file ? req.file.path : null;

  try {
    const { id } = req.params;
    const { reason } = req.body;

    const complaint = mongoose.Types.ObjectId.isValid(id)
      ? await Complaint.findById(id)
      : await Complaint.findOne({ trackingId: id.trim().toUpperCase() });

    if (!complaint) {
      cleanupUploadedFiles(req);
      return res.status(404).json({
        error: 'Not Found',
        message: 'Complaint not found.'
      });
    }

    // Role & Ownership Authorization Guard
    if (!complaint.citizen || !complaint.citizen.equals(req.user._id)) {
      cleanupUploadedFiles(req);
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied. You are only authorized to dispute complaints filed by your account.'
      });
    }

    // Lifecycle Status Precondition Guard
    if (complaint.status !== 'Provisionally Resolved') {
      cleanupUploadedFiles(req);
      return res.status(400).json({
        error: 'Bad Request',
        message: `Cannot dispute resolution. Complaint is currently in '${complaint.status}' status (must be 'Provisionally Resolved').`
      });
    }

    // Reason Validation
    if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
      cleanupUploadedFiles(req);
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Dispute reason is required and must be at least 10 characters long.'
      });
    }

    if (reason.trim().length > 1000) {
      cleanupUploadedFiles(req);
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Dispute reason cannot exceed 1000 characters.'
      });
    }

    // Optional Dispute Photograph Validation
    let disputePhotoData = null;
    if (req.file) {
      const fileBuffer = fs.readFileSync(req.file.path);
      const isValidFormat = validateImageMagicBytes(fileBuffer);
      if (!isValidFormat) {
        cleanupUploadedFiles(req);
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Uploaded dispute photograph must be a valid JPEG or PNG image format.'
        });
      }

      const storageFilename = path.basename(req.file.path);
      const originalName = req.file.originalname || 'dispute-evidence.jpg';
      const detectedMime = req.file.mimetype || 'image/jpeg';
      const fileSize = req.file.size;

      disputePhotoData = {
        imageUrl: `/api/complaints/${complaint._id}/dispute-evidence`,
        storageKey: storageFilename,
        originalName: originalName,
        mimeType: detectedMime,
        sizeBytes: fileSize,
        submittedAt: new Date()
      };
    }

    // Atomic Status Transition
    const updatedComplaint = await Complaint.findOneAndUpdate(
      {
        _id: complaint._id,
        status: 'Provisionally Resolved'
      },
      {
        $set: {
          status: 'Disputed',
          'sla.disputedAt': new Date(),
          resolutionDispute: {
            reason: reason.trim(),
            photo: disputePhotoData,
            submittedAt: new Date(),
            citizen: req.user._id,
            status: 'pending_review',
            adminDecision: null,
            adminNotes: '',
            reviewedAt: null,
            reviewedBy: null
          }
        },
        $push: {
          statusHistory: {
            status: 'Disputed',
            timestamp: new Date(),
            comment: `Resolution disputed by citizen: ${reason.trim().slice(0, 150)}`,
            actor: req.user._id,
            actorRole: 'citizen'
          }
        }
      },
      { new: true, runValidators: true }
    );

    if (!updatedComplaint) {
      cleanupUploadedFiles(req);
      return res.status(409).json({
        error: 'Conflict',
        message: 'Complaint is no longer in provisionally resolved status or was concurrently modified by another process.'
      });
    }

    // Send In-App Notifications
    if (updatedComplaint.assignedOfficer) {
      await sendNotification({
        recipient: updatedComplaint.assignedOfficer,
        actor: req.user._id,
        actorRole: 'citizen',
        complaint: updatedComplaint._id,
        trackingId: updatedComplaint.trackingId,
        type: 'resolution_disputed',
        title: 'Complaint Resolution Disputed',
        message: `Citizen ${req.user.name} has disputed the completion of complaint "${updatedComplaint.title}" (${updatedComplaint.trackingId}). Reason: ${reason.trim()}`
      });
    }

    const adminUser = await User.findOne({ role: 'admin' });
    if (adminUser) {
      await sendNotification({
        recipient: adminUser._id,
        actor: req.user._id,
        actorRole: 'citizen',
        complaint: updatedComplaint._id,
        trackingId: updatedComplaint.trackingId,
        type: 'resolution_disputed',
        title: 'Dispute Filed — Review Required',
        message: `Citizen ${req.user.name} has disputed completion on complaint "${updatedComplaint.title}" (${updatedComplaint.trackingId}). Reason: ${reason.trim()}`
      });
    }

    return res.status(200).json({
      message: 'Resolution dispute submitted successfully. Complaint is under administrative review.',
      complaint: updatedComplaint.toSafeObject(req.user)
    });
  } catch (error) {
    cleanupUploadedFiles(req);
    next(error);
  }
});

/**
 * @route   PATCH /api/complaints/:id/admin-review
 * @desc    Administrator reviews disputed complaint and decides: accept resolution or reopen work
 * @access  Protected (Admin only)
 */
router.patch('/:id/admin-review', authorize('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action, reviewNotes } = req.body;

    const complaint = mongoose.Types.ObjectId.isValid(id)
      ? await Complaint.findById(id)
      : await Complaint.findOne({ trackingId: id.trim().toUpperCase() });

    if (!complaint) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Complaint not found.'
      });
    }

    // Lifecycle Status Precondition Guard
    if (complaint.status !== 'Disputed') {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Only complaints in 'Disputed' status can be reviewed by an administrator (current status: '${complaint.status}').`
      });
    }

    const normalizedAction = (action || '').toLowerCase().trim();
    const isAccept = normalizedAction === 'accept' || normalizedAction === 'confirm_resolution';
    const isReopen = normalizedAction === 'reopen' || normalizedAction === 'return_in_progress';

    if (!isAccept && !isReopen) {
      return res.status(400).json({
        error: 'Bad Request',
        message: "Invalid review action. Allowed actions are 'accept' (confirm resolution) or 'reopen' (return in progress)."
      });
    }

    const trimmedNotes = typeof reviewNotes === 'string' ? reviewNotes.trim() : '';

    if (isReopen) {
      if (!trimmedNotes || trimmedNotes.length < 5) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Admin review reason is required when reopening a complaint for rework (minimum 5 characters).'
        });
      }
      if (trimmedNotes.length > 1000) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Admin review notes cannot exceed 1000 characters.'
        });
      }
    } else if (trimmedNotes.length > 1000) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Admin review notes cannot exceed 1000 characters.'
      });
    }

    let updatedComplaint;

    if (isAccept) {
      const now = new Date();
      const resDeadline = complaint.sla?.resolutionDeadline ? new Date(complaint.sla.resolutionDeadline) : null;
      const isWithinSla = resDeadline ? (now <= resDeadline) : true;
      const startMs = complaint.sla?.startedAt ? new Date(complaint.sla.startedAt).getTime() : new Date(complaint.createdAt).getTime();
      const durationMs = now.getTime() - startMs;

      // Admin Decision A: Accept Resolution -> final Resolved
      updatedComplaint = await Complaint.findOneAndUpdate(
        {
          _id: complaint._id,
          status: 'Disputed'
        },
        {
          $set: {
            status: 'Resolved',
            resolvedAt: now,
            'sla.isResolvedWithinSla': isWithinSla,
            'sla.totalResolutionDurationMs': durationMs,
            'resolutionDispute.status': 'resolved_by_admin',
            'resolutionDispute.adminDecision': 'confirm_resolution',
            'resolutionDispute.adminNotes': trimmedNotes || 'Resolution confirmed by administrator after dispute review.',
            'resolutionDispute.reviewedAt': now,
            'resolutionDispute.reviewedBy': req.user._id
          },
          $push: {
            statusHistory: {
              status: 'Resolved',
              timestamp: new Date(),
              comment: `Admin confirmed resolution after dispute review. Notes: ${trimmedNotes || 'Work confirmed satisfactory.'}`,
              actor: req.user._id,
              actorRole: 'admin'
            }
          }
        },
        { new: true, runValidators: true }
      );

      if (!updatedComplaint) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Complaint is no longer in disputed status or was concurrently modified by another process.'
        });
      }

      // Notify citizen and officer
      await sendNotification({
        recipient: updatedComplaint.citizen,
        actor: req.user._id,
        actorRole: 'admin',
        complaint: updatedComplaint._id,
        trackingId: updatedComplaint.trackingId,
        type: 'resolution_admin_closed',
        title: 'Dispute Review: Resolution Upheld',
        message: `Administrator has reviewed the dispute on complaint "${updatedComplaint.title}" (${updatedComplaint.trackingId}) and confirmed the resolution. Notes: ${trimmedNotes || 'Resolution upheld.'}`
      });

      if (updatedComplaint.assignedOfficer) {
        await sendNotification({
          recipient: updatedComplaint.assignedOfficer,
          actor: req.user._id,
          actorRole: 'admin',
          complaint: updatedComplaint._id,
          trackingId: updatedComplaint.trackingId,
          type: 'complaint_resolved',
          title: 'Dispute Resolved by Admin',
          message: `Administrator has reviewed the dispute and confirmed resolution for complaint "${updatedComplaint.title}" (${updatedComplaint.trackingId}).`
        });
      }

      return res.status(200).json({
        message: 'Dispute reviewed: Resolution upheld and complaint marked as resolved.',
        complaint: updatedComplaint.toSafeObject(req.user)
      });
    } else {
      // Admin Decision B: Reopen Work -> return to In Progress
      const nextReworkCount = (complaint.reworkCount || 0) + 1;
      const reworkDeadline = calculateReworkDeadline(complaint.priority, new Date());
      updatedComplaint = await Complaint.findOneAndUpdate(
        {
          _id: complaint._id,
          status: 'Disputed'
        },
        {
          $set: {
            status: 'In Progress',
            'resolutionDispute.status': 'returned_in_progress',
            'resolutionDispute.adminDecision': 'return_in_progress',
            'resolutionDispute.adminNotes': trimmedNotes,
            'resolutionDispute.reviewedAt': new Date(),
            'resolutionDispute.reviewedBy': req.user._id,
            'sla.reworkDeadline': reworkDeadline,
            'sla.reworkStartedAt': new Date(),
            'sla.provisionallyResolvedAt': null,
            'sla.isReworkBreached': false
          },
          $inc: {
            reworkCount: 1
          },
          $push: {
            statusHistory: {
              status: 'In Progress',
              timestamp: new Date(),
              comment: `Admin reopened complaint for rework (Rework #${nextReworkCount}). Reason: ${trimmedNotes}`,
              actor: req.user._id,
              actorRole: 'admin'
            }
          }
        },
        { new: true, runValidators: true }
      );

      if (!updatedComplaint) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Complaint is no longer in disputed status or was concurrently modified by another process.'
        });
      }

      // Notify officer and citizen
      if (updatedComplaint.assignedOfficer) {
        await sendNotification({
          recipient: updatedComplaint.assignedOfficer,
          actor: req.user._id,
          actorRole: 'admin',
          complaint: updatedComplaint._id,
          trackingId: updatedComplaint.trackingId,
          type: 'resolution_reopened',
          title: 'Complaint Reopened for Rework',
          message: `Administrator has reopened complaint "${updatedComplaint.title}" (${updatedComplaint.trackingId}) for rework. Reason: ${trimmedNotes}`
        });
      }

      await sendNotification({
        recipient: updatedComplaint.citizen,
        actor: req.user._id,
        actorRole: 'admin',
        complaint: updatedComplaint._id,
        trackingId: updatedComplaint.trackingId,
        type: 'status_changed',
        title: 'Complaint Reopened for Further Work',
        message: `Administrator has reviewed your dispute on complaint "${updatedComplaint.title}" (${updatedComplaint.trackingId}) and returned the complaint to In Progress for further officer action. Notes: ${trimmedNotes}`
      });

      return res.status(200).json({
        message: 'Dispute reviewed: Complaint reopened and returned to In Progress for rework.',
        complaint: updatedComplaint.toSafeObject(req.user)
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PATCH /api/complaints/:id/assign
 * @desc    Assign a complaint to an officer
 * @access  Protected (Admin only)
 */
router.patch('/:id/assign', authorize('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { officerId, department, comment } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid complaint ID format.'
      });
    }

    if (!officerId || !mongoose.Types.ObjectId.isValid(officerId)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'A valid officerId is required.'
      });
    }

    const complaint = await Complaint.findById(id);
    if (!complaint) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Complaint not found.'
      });
    }

    // Capture previous assigned officer before updating
    const previousOfficerId = complaint.assignedOfficer ? complaint.assignedOfficer.toString() : null;

    // Verify officer exists and has officer role
    const officer = await User.findById(officerId);
    if (!officer) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Target user does not exist.'
      });
    }

    if (officer.role !== 'officer') {
      return res.status(400).json({
        error: 'Bad Request',
        message: `User '${officer.name}' cannot be assigned because their role is '${officer.role}', not 'officer'.`
      });
    }

    // Set assigned officer and department
    complaint.assignedOfficer = officer._id;
    if (department && typeof department === 'string' && department.trim()) {
      complaint.department = department.trim();
    } else if (officer.department) {
      complaint.department = officer.department;
    }

    // If status was Submitted, advance to Under Review upon assignment
    if (complaint.status === 'Submitted') {
      complaint.status = 'Under Review';
    }

    const assignmentComment = comment && typeof comment === 'string' && comment.trim()
      ? comment.trim()
      : `Assigned to officer ${officer.name}${complaint.department ? ` (${complaint.department})` : ''}.`;

    // Append to status history
    complaint.statusHistory.push({
      status: complaint.status,
      timestamp: new Date(),
      comment: assignmentComment,
      actor: req.user._id,
      actorRole: 'admin'
    });

    // SLA Milestone Tracking
    if (!complaint.sla) complaint.sla = {};
    if (!complaint.sla.assignedAt) {
      complaint.sla.assignedAt = new Date();
    }
    if (!complaint.sla.acknowledgedAt) {
      complaint.sla.acknowledgedAt = new Date();
    }

    await complaint.save();

    // In-App Notifications
    const isReassignment = previousOfficerId && previousOfficerId !== officer._id.toString();

    // 1. Notify newly assigned officer
    await sendNotification({
      recipient: officer._id,
      actor: req.user._id,
      actorRole: 'admin',
      complaint: complaint._id,
      trackingId: complaint.trackingId,
      type: isReassignment ? 'complaint_reassigned' : 'complaint_assigned',
      title: isReassignment ? 'Complaint Reassigned to You' : 'New Complaint Assigned',
      message: `Complaint ${complaint.trackingId} (${complaint.title}) has been assigned to you for department review.`
    });

    // 2. If reassigned, notify previous officer
    if (isReassignment) {
      await sendNotification({
        recipient: previousOfficerId,
        actor: req.user._id,
        actorRole: 'admin',
        complaint: complaint._id,
        trackingId: complaint.trackingId,
        type: 'complaint_reassigned',
        title: 'Complaint Reassigned',
        message: `Complaint ${complaint.trackingId} has been reassigned to officer ${officer.name}.`
      });
    }

    // 3. Notify citizen owner
    await sendNotification({
      recipient: complaint.citizen,
      actor: req.user._id,
      actorRole: 'admin',
      complaint: complaint._id,
      trackingId: complaint.trackingId,
      type: 'complaint_assigned',
      title: 'Officer Assigned to Your Complaint',
      message: `Your complaint ${complaint.trackingId} has been assigned to officer ${officer.name} (${complaint.department || 'Operations'}).`
    });

    const populatedComplaint = await Complaint.findById(complaint._id)
      .populate('citizen', 'name email')
      .populate('assignedOfficer', 'name email department');

    return res.status(200).json({
      message: 'Complaint assigned successfully',
      complaint: populatedComplaint.toSafeObject()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PATCH /api/complaints/:id/status
 * @desc    Update complaint status through permitted state transitions
 * @access  Protected (Assigned Officer or Admin)
 */
router.patch('/:id/status', authorize('officer', 'admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status: newStatus, comment, resolutionNotes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid complaint ID format.'
      });
    }

    if (!newStatus || !VALID_STATUSES.includes(newStatus)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid or missing status. Permitted values: ${VALID_STATUSES.join(', ')}`
      });
    }

    const complaint = await Complaint.findById(id);
    if (!complaint) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Complaint not found.'
      });
    }

    // Authorization: If officer, must be explicitly assigned to this complaint
    if (req.user.role === 'officer') {
      if (!complaint.assignedOfficer || !complaint.assignedOfficer.equals(req.user._id)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied. You are only authorized to update complaints explicitly assigned to you.'
        });
      }
    }

    // Check transition validity
    const currentStatus = complaint.status;
    if (currentStatus === newStatus) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Complaint is already in '${newStatus}' status.`
      });
    }

    // CivicTrack 2.0 Hybrid Approval Lifecycle Guards:
    // Generic status updates cannot be used to trigger or advance provisional resolution workflows
    if (newStatus === 'Provisionally Resolved') {
      return res.status(400).json({
        error: 'Bad Request',
        message: "Transition to 'Provisionally Resolved' requires submission of geo-verified completion evidence via the work completion workflow."
      });
    }

    if (newStatus === 'Disputed') {
      return res.status(400).json({
        error: 'Bad Request',
        message: "Transition to 'Disputed' can only be initiated by the citizen via the dispute submission workflow."
      });
    }

    if (currentStatus === 'Provisionally Resolved' || currentStatus === 'Disputed') {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Complaints in '${currentStatus}' status can only be transitioned via citizen confirmation, citizen dispute, or administrative review workflows.`
      });
    }

    const allowedNextStatuses = PERMITTED_TRANSITIONS[currentStatus] || [];
    if (!allowedNextStatuses.includes(newStatus)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid status transition from '${currentStatus}' to '${newStatus}'. Permitted transitions: ${allowedNextStatuses.join(', ') || 'None (terminal status)'}.`
      });
    }

    // Require resolution notes if transitioning to Resolved
    if (newStatus === 'Resolved') {
      const finalNote = (resolutionNotes || comment || '').trim();
      if (!finalNote || finalNote.length < 5) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Resolution notes (minimum 5 characters) are required when resolving a complaint.'
        });
      }
      complaint.resolutionNotes = finalNote;
      complaint.resolvedAt = new Date();
    }

    // Build comment for status history
    let historyComment = comment && typeof comment === 'string' ? comment.trim() : '';
    if (!historyComment) {
      if (newStatus === 'Resolved') {
        historyComment = `Complaint resolved: ${complaint.resolutionNotes}`;
      } else {
        historyComment = `Status updated to ${newStatus} by ${req.user.name}.`;
      }
    }

    complaint.status = newStatus;
    complaint.statusHistory.push({
      status: newStatus,
      timestamp: new Date(),
      comment: historyComment,
      actor: req.user._id,
      actorRole: req.user.role
    });

    // SLA Milestone Tracking
    if (!complaint.sla) complaint.sla = {};
    if (newStatus === 'Under Review' && !complaint.sla.acknowledgedAt) {
      complaint.sla.acknowledgedAt = new Date();
    } else if (newStatus === 'In Progress' && !complaint.sla.workStartedAt) {
      complaint.sla.workStartedAt = new Date();
    } else if (newStatus === 'Rejected') {
      complaint.sla.stoppedAt = new Date();
      complaint.sla.isResolvedWithinSla = false;
    } else if (newStatus === 'Resolved') {
      const resDeadline = complaint.sla.resolutionDeadline ? new Date(complaint.sla.resolutionDeadline) : null;
      complaint.sla.isResolvedWithinSla = resDeadline ? (new Date() <= resDeadline) : true;
      const startMs = complaint.sla.startedAt ? new Date(complaint.sla.startedAt).getTime() : new Date(complaint.createdAt).getTime();
      complaint.sla.totalResolutionDurationMs = new Date().getTime() - startMs;
    }

    await complaint.save();

    // In-App Notification to Citizen
    await sendNotification({
      recipient: complaint.citizen,
      actor: req.user._id,
      actorRole: req.user.role,
      complaint: complaint._id,
      trackingId: complaint.trackingId,
      type: newStatus === 'Resolved' ? 'complaint_resolved' : 'status_changed',
      title: newStatus === 'Resolved' ? 'Complaint Resolved' : `Complaint Status: ${newStatus}`,
      message:
        newStatus === 'Resolved'
          ? `Your complaint ${complaint.trackingId} has been resolved! Resolution notes: ${complaint.resolutionNotes}`
          : `Your complaint ${complaint.trackingId} status has been updated to "${newStatus}".`
    });

    return res.status(200).json({
      message: `Complaint status updated to ${newStatus}`,
      complaint: complaint.toSafeObject()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PATCH /api/complaints/:id/resolution
 * @desc    Record resolution notes and optionally mark as resolved
 * @access  Protected (Assigned Officer or Admin)
 */
router.patch('/:id/resolution', authorize('officer', 'admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { resolutionNotes, markResolved } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid complaint ID format.'
      });
    }

    if (!resolutionNotes || typeof resolutionNotes !== 'string' || resolutionNotes.trim().length < 5) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Resolution notes must be at least 5 characters long.'
      });
    }

    if (resolutionNotes.trim().length > 2000) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Resolution notes cannot exceed 2000 characters.'
      });
    }

    const complaint = await Complaint.findById(id);
    if (!complaint) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Complaint not found.'
      });
    }

    // Authorization: If officer, must be explicitly assigned to this complaint
    if (req.user.role === 'officer') {
      if (!complaint.assignedOfficer || !complaint.assignedOfficer.equals(req.user._id)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied. You are only authorized to update complaints explicitly assigned to you.'
        });
      }
    }

    complaint.resolutionNotes = resolutionNotes.trim();

    // CivicTrack 2.0 Guard: Direct resolution from In Progress is prevented
    if (markResolved && complaint.status === 'In Progress') {
      return res.status(400).json({
        error: 'Bad Request',
        message: "Direct resolution from 'In Progress' is not permitted. Officers must submit geo-verified completion evidence for provisional resolution."
      });
    }

    complaint.statusHistory.push({
      status: complaint.status,
      timestamp: new Date(),
      comment: `Resolution notes updated: ${complaint.resolutionNotes}`,
      actor: req.user._id,
      actorRole: req.user.role
    });

    await complaint.save();

    // In-App Notification to Citizen
    await sendNotification({
      recipient: complaint.citizen,
      actor: req.user._id,
      actorRole: req.user.role,
      complaint: complaint._id,
      trackingId: complaint.trackingId,
      type: complaint.status === 'Resolved' ? 'complaint_resolved' : 'notes_updated',
      title: complaint.status === 'Resolved' ? 'Complaint Resolved' : 'Resolution Notes Updated',
      message: `Official resolution notes updated on complaint ${complaint.trackingId}: ${complaint.resolutionNotes}`
    });

    return res.status(200).json({
      message: 'Resolution details saved successfully',
      complaint: complaint.toSafeObject()
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

