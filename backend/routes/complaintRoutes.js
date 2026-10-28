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

const router = express.Router();

// Apply authentication to ALL complaint endpoints
router.use(authenticate);

// Permitted status state machine transitions
const PERMITTED_TRANSITIONS = {
  'Submitted': ['Under Review', 'Rejected'],
  'Under Review': ['In Progress', 'Rejected'],
  'In Progress': ['Resolved', 'Rejected'],
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
    cb(null, `evidence-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${cleanExt}`);
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
      priority: 'Medium',
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
    const [total, submitted, underReview, inProgress, resolved, rejected] = await Promise.all([
      Complaint.countDocuments({ citizen: citizenId }),
      Complaint.countDocuments({ citizen: citizenId, status: 'Submitted' }),
      Complaint.countDocuments({ citizen: citizenId, status: 'Under Review' }),
      Complaint.countDocuments({ citizen: citizenId, status: 'In Progress' }),
      Complaint.countDocuments({ citizen: citizenId, status: 'Resolved' }),
      Complaint.countDocuments({ citizen: citizenId, status: 'Rejected' })
    ]);

    return res.status(200).json({
      summary: {
        total,
        submitted,
        underReview,
        inProgress,
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
        ...c.toSafeObject(),
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

    const [totalAssigned, submitted, underReview, inProgress, resolved, rejected] = await Promise.all([
      Complaint.countDocuments({ assignedOfficer: officerId }),
      Complaint.countDocuments({ assignedOfficer: officerId, status: 'Submitted' }),
      Complaint.countDocuments({ assignedOfficer: officerId, status: 'Under Review' }),
      Complaint.countDocuments({ assignedOfficer: officerId, status: 'In Progress' }),
      Complaint.countDocuments({ assignedOfficer: officerId, status: 'Resolved' }),
      Complaint.countDocuments({ assignedOfficer: officerId, status: 'Rejected' })
    ]);

    return res.status(200).json({
      summary: {
        totalAssigned,
        submitted,
        underReview,
        inProgress,
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
        activeIssues: byStatus['Submitted'] + byStatus['Under Review'] + byStatus['In Progress'],
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

    const total = await Complaint.countDocuments(query);
    const complaints = await Complaint.find(query)
      .populate('citizen', 'name email')
      .populate('assignedOfficer', 'name email department')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.status(200).json({
      complaints: complaints.map((c) => ({
        ...c.toSafeObject(),
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
    if (req.user.role === 'citizen') {
      query.citizen = req.user._id;
    } else if (req.user.role === 'officer') {
      query.assignedOfficer = req.user._id;
    }
    // Admin has unrestricted read access

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
      complaint: complaint.toSafeObject()
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
      complaint: complaint.toSafeObject()
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
    const safeKey = path.basename(complaint.evidence.storageKey);
    const filePath = path.resolve(resolvedUploadDir, safeKey);
    if (!filePath.startsWith(resolvedUploadDir) || !fs.existsSync(filePath)) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Evidence photograph file is missing from server storage.'
      });
    }

    res.setHeader('Content-Type', complaint.evidence.mimetype || 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename="${complaint.evidence.storageKey}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.sendFile(filePath);
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

    // If requested and complaint is In Progress, advance to Resolved
    if (markResolved && complaint.status === 'In Progress') {
      complaint.status = 'Resolved';
      complaint.resolvedAt = new Date();
      complaint.statusHistory.push({
        status: 'Resolved',
        timestamp: new Date(),
        comment: `Resolution recorded: ${complaint.resolutionNotes}`,
        actor: req.user._id,
        actorRole: req.user.role
      });
    } else {
      complaint.statusHistory.push({
        status: complaint.status,
        timestamp: new Date(),
        comment: `Resolution notes updated: ${complaint.resolutionNotes}`,
        actor: req.user._id,
        actorRole: req.user.role
      });
    }

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

