import mongoose from 'mongoose';

const schedulerSettingsSchema = new mongoose.Schema({
  scheduleRateMinutes: {
    type: Number,
    required: true,
    min: 1,
    max: 1440,
    default: 60
  },
  uploadToSync: {
    type: Boolean,
    default: false
  },
  isScheduled: {
    type: Boolean,
    default: false
  },
  eventUpdateFilterMinutes: {
    type: Number,
    min: 0,
    max: 10080, // 7 days in minutes
    default: 0
  },
  lastRunAt: {
    type: Date,
    default: null
  },
  nextRunAt: {
    type: Date,
    default: null
  },
  totalRuns: {
    type: Number,
    default: 0
  },
  lastCsvGenerated: {
    type: String,
    default: null
  },
  lastUploadAt: {
    type: Date,
    default: null
  },
  lastUploadStatus: {
    type: String,
    enum: ['success', 'failed', 'cleared', 'clear_failed'],
    default: null
  },
  lastUploadId: {
    type: String,
    default: null
  },
  lastUploadError: {
    type: String,
    default: null
  },
  lastClearAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Ensure only one settings document exists
schedulerSettingsSchema.statics.getSettings = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({
      scheduleRateMinutes: 60,
      uploadToSync: false,
      isScheduled: false,
      eventUpdateFilterMinutes: 0
    });
  }
  return settings;
};

schedulerSettingsSchema.statics.updateSettings = async function(updates) {
  const settings = await this.getSettings();
  Object.assign(settings, updates, { updatedAt: new Date() });
  return await settings.save();
};

export const SchedulerSettings = mongoose.models.SchedulerSettings || mongoose.model('SchedulerSettings', schedulerSettingsSchema);