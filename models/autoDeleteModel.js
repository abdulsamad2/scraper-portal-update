import mongoose from 'mongoose';

const autoDeleteSettingsSchema = new mongoose.Schema({
  isEnabled: {
    type: Boolean,
    default: false
  },
  stopBeforeHours: {
    type: Number,
    min: 0,
    max: 168, // 7 days max
    default: 2 // 2 hours before event time (e.g., 7pm event -> stop/delete at 5pm)
  },
  scheduleIntervalMinutes: {
    type: Number,
    min: 1,
    max: 1440,
    default: 15 // Run every 15 minutes (check frequently for pre-event deletions)
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
  totalEventsDeleted: {
    type: Number,
    default: 0
  },
  lastRunStats: {
    eventsChecked: {
      type: Number,
      default: 0
    },
    eventsDeleted: {
      type: Number,
      default: 0
    },
    eventsStopped: {
      type: Number,
      default: 0
    },
    deletedEventIds: [{
      type: String
    }],
    errors: [{
      type: String
    }]
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
autoDeleteSettingsSchema.statics.getSettings = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({
      isEnabled: false,
      stopBeforeHours: 2,
      scheduleIntervalMinutes: 15
    });
  }
  return settings;
};

autoDeleteSettingsSchema.statics.updateSettings = async function(updates) {
  const settings = await this.getSettings();
  Object.assign(settings, updates, { updatedAt: new Date() });
  return await settings.save();
};

const AutoDeleteSettings = mongoose.models.AutoDeleteSettings || mongoose.model('AutoDeleteSettings', autoDeleteSettingsSchema);

export { AutoDeleteSettings };