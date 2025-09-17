import mongoose from 'mongoose';

const autoDeleteSettingsSchema = new mongoose.Schema({
  isEnabled: {
    type: Boolean,
    default: false
  },
  graceHours: {
    type: Number,
    min: 1,
    max: 168, // 7 days max
    default: 15 // 15 hours default (9pm event -> 12pm next day deletion)
  },
  scheduleIntervalHours: {
    type: Number,
    min: 1,
    max: 168,
    default: 24 // Run every 24 hours
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
      graceHours: 15,
      scheduleIntervalHours: 24
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