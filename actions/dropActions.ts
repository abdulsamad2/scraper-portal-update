'use server';

import { revalidatePath } from 'next/cache';
import dbConnect from '@/lib/dbConnect';
import { SeatDrop } from '@/models/seatDropModel';

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
