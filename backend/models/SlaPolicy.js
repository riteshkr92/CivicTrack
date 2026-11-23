const mongoose = require('mongoose');

const slaPolicySchema = new mongoose.Schema(
  {
    version: {
      type: String,
      required: true,
      default: 'v1.0',
      trim: true
    },
    description: {
      type: String,
      default: 'Municipal Smart SLA Policy Configuration',
      trim: true
    },
    priorityTargets: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    categoryResolutionOverrides: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    escalationRules: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    isActive: {
      type: Boolean,
      default: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true
  }
);

slaPolicySchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

const SlaPolicy = mongoose.model('SlaPolicy', slaPolicySchema);

module.exports = { SlaPolicy };
