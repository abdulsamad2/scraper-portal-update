import mongoose from "mongoose";

// Schema for section and row exclusions
const sectionRowExclusionSchema = new mongoose.Schema({
  section: {
    type: String,
    required: true
  },
  excludeEntireSection: {
    type: Boolean,
    default: false
  },
  excludedRows: [{
    type: String
  }]
}, { _id: false });



const exclusionRulesSchema = new mongoose.Schema({
  eventId: {
    type: String,
    required: true,
    unique: true // One exclusion rule per event (_id)
  },
  eventName: {
    type: String,
    required: true
  },
  sectionRowExclusions: [sectionRowExclusionSchema],
  isActive: {
    type: Boolean,
    default: true
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: String,
    default: 'system'
  }
}, {
  timestamps: true
});

// Index for faster lookups (eventId index already created by unique: true)
exclusionRulesSchema.index({ isActive: 1 });

// Update lastUpdated on save
exclusionRulesSchema.pre('save', function(next) {
  this.lastUpdated = new Date();
  next();
});

export const ExclusionRules = mongoose.models.ExclusionRules || mongoose.model("ExclusionRules", exclusionRulesSchema);