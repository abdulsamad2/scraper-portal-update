'use server';

import { revalidatePath } from 'next/cache';
import dbConnect from '@/lib/dbConnect';
import { SeatDrop } from '@/models/seatDropModel';
import { DropSettings } from '@/models/dropSettingsModel';
import { invalidateHoldCache } from '@/lib/drops';

/**
 * Seat-drop mutations. Reads live in lib/drops.ts and run during the Server
 * Component render — only the writes need to be server actions.
 *
 * Both are driven by plain <form action={...}> submissions, so acknowledging
 * works with JavaScript disabled and needs no client-side fetch.
 */

const PAGE = '/dashboard/drops';

/** Acknowledge one drop — clears the alarm only, never deletes history. */
export async function acknowledgeDrop(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await dbConnect();
  try {
    await SeatDrop.updateOne({ _id: id }, { $set: { seen: true } });
    revalidatePath(PAGE);
  } catch (error) {
    console.error('Error acknowledging seat drop:', error);
  }
}

/** Acknowledge every outstanding drop. */
export async function acknowledgeAllDrops() {
  await dbConnect();
  try {
    await SeatDrop.updateMany({ seen: false }, { $set: { seen: true } });
    revalidatePath(PAGE);
  } catch (error) {
    console.error('Error acknowledging all seat drops:', error);
  }
}

/**
 * Change how long a drop is held out of the CSV.
 *
 * Stored in drop_settings, which the scraper reads too — so this one control
 * moves both halves of the rule at once: when the scraper deletes a matured
 * drop, and when this portal stops withholding its listing.
 */
export async function setDropHoldMinutes(formData: FormData) {
  await dbConnect();
  const raw = Number(formData.get('holdMinutes'));
  if (!Number.isFinite(raw) || raw < 1 || raw > 1440) return;
  const holdMinutes = Math.round(raw);

  try {
    await DropSettings.updateOne(
      { key: 'singleton' },
      { $set: { holdMinutes } },
      { upsert: true }
    );
    invalidateHoldCache(); // so the next render shows it, not the cached value
    revalidatePath(PAGE);
  } catch (error) {
    console.error('Error saving drop hold:', error);
  }
}
