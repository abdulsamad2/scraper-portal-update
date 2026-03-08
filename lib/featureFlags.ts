import { NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { FeatureFlags } from '../models/featureFlagModel.js';

export type FlagState = 'enabled' | 'hidden' | 'disabled';

/**
 * Normalize a flag value from DB (handles legacy booleans).
 */
function normalize(value: unknown): FlagState {
  if (value === true || value === 'enabled') return 'enabled';
  if (value === 'hidden') return 'hidden';
  if (value === false || value === 'disabled') return 'disabled';
  return 'enabled'; // unknown → default enabled
}

/**
 * Check if a feature is API-blocked ("disabled" state).
 * Returns null if allowed (enabled or hidden), or 403 if disabled.
 * "hidden" = UI hidden but API still works.
 * "disabled" = UI hidden AND API blocked.
 */
export async function requireFeatureFlag(
  flagKey: string
): Promise<NextResponse | null> {
  try {
    await dbConnect();
    const flags = await FeatureFlags.findOne({}).lean();
    if (!flags) return null;

    const state = normalize((flags as Record<string, unknown>)[flagKey]);
    if (state === 'disabled') {
      return NextResponse.json(
        { success: false, message: 'This feature is currently disabled' },
        { status: 403 }
      );
    }
    return null; // enabled or hidden → API allowed
  } catch {
    return null;
  }
}

/**
 * Check if a feature is visible in UI (not hidden or disabled).
 * Returns true only for "enabled" state.
 */
export function isFeatureVisible(value: unknown): boolean {
  return normalize(value) === 'enabled';
}
