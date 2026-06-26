import mongoose from 'mongoose';
import path from 'path';
import { DATA_DIR } from '../config.js';

const applicationSchema = new mongoose.Schema({
  url: { type: String, index: true },
  company: { type: String },
  role: { type: String },
  verdict: { type: String, required: true },
  failure_reason: { type: String },
  run_id: { type: String },
  timestamp: { type: Date, default: Date.now, required: true }
});

applicationSchema.index({ company: 1, role: 1 });

export const Application = mongoose.models.Application || mongoose.model('Application', applicationSchema);

export async function openApplicationLedger() {
  if (mongoose.connection.readyState === 0) {
    try {
      const dotenv = await import('dotenv');
      dotenv.config({ path: path.join(DATA_DIR, '..', '.env') });
    } catch { /* ignore */ }
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/gpt_auth';
    await mongoose.connect(mongoUri);
  }
  return Application;
}

export async function findSuccessfulApplication({ url, company, role } = {}) {
  await openApplicationLedger();
  if (url) {
    const row = await Application.findOne({ url, verdict: 'success' }).sort({ timestamp: -1 });
    if (row) return row.toObject();
  }
  if (company && role) {
    const row = await Application.findOne({
      company: { $regex: new RegExp(`^${company.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') },
      role: { $regex: new RegExp(`^${role.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') },
      verdict: 'success'
    }).sort({ timestamp: -1 });
    return row ? row.toObject() : null;
  }
  return null;
}

export async function recordApplicationVerdict({ url, company, role, verdict, failure_reason, run_id }) {
  await openApplicationLedger();
  await Application.create({
    url: url || null,
    company: company || null,
    role: role || null,
    verdict: verdict || 'failure',
    failure_reason: failure_reason || null,
    run_id: run_id || null,
    timestamp: new Date()
  });
}
