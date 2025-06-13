'use server';

import dbConnect from '@/lib/dbConnect';
import { ConsecutiveGroup } from '@/models/seatModel'; // Assuming models are aliased to @/models
import { revalidatePath } from 'next/cache';

/**
 * Creates a new consecutive seat group.
 * @param {object} groupData - The data for the new group.
 * @returns {Promise<object>} The created group object or an error object.
 */
export async function createConsecutiveGroup(groupData: any) {
  await dbConnect();
  try {
    const newGroup = new ConsecutiveGroup(groupData);
    const savedGroup = await newGroup.save();
    revalidatePath('/seat-groups'); // Adjust path as needed
    revalidatePath(`/seat-groups/${savedGroup._id}`);
    return JSON.parse(JSON.stringify(savedGroup));
  } catch (error: any) {
    console.error('Error creating consecutive group:', error);
    return { error: error.message || 'Failed to create consecutive group' };
  }
}

/**
 * Retrieves all consecutive groups.
 * @returns {Promise<Array<object>>} An array of group objects or an error object.
 */
export async function getAllConsecutiveGroups() {
  await dbConnect();
  try {
    const groups = await ConsecutiveGroup.find({});
    return JSON.parse(JSON.stringify(groups));
  } catch (error: any) {
    console.error('Error fetching all consecutive groups:', error);
    return { error: error.message || 'Failed to fetch consecutive groups' };
  }
}

/**
 * Retrieves a single consecutive group by its ID.
 * @param {string} groupId - The ID of the group to retrieve.
 * @returns {Promise<object|null>} The group object or null if not found, or an error object.
 */
export async function getConsecutiveGroupById(groupId) {
  await dbConnect();
  try {
    const group = await ConsecutiveGroup.findById(groupId);
    if (!group) {
      return null;
    }
    return JSON.parse(JSON.stringify(group));
  } catch (error: any) {
    console.error('Error fetching consecutive group by ID:', error);
    return { error: error.message || 'Failed to fetch consecutive group' };
  }
}

/**
 * Updates an existing consecutive group.
 * @param {string} groupId - The ID of the group to update.
 * @param {object} updateData - An object containing the fields to update.
 * @returns {Promise<object|null>} The updated group object or null if not found, or an error object.
 */
export async function updateConsecutiveGroup(groupId, updateData) {
  await dbConnect();
  try {
    const updatedGroup = await ConsecutiveGroup.findByIdAndUpdate(groupId, updateData, {
      new: true,
      runValidators: true,
    });
    if (!updatedGroup) {
      return null;
    }
    revalidatePath('/seat-groups');
    revalidatePath(`/seat-groups/${groupId}`);
    return JSON.parse(JSON.stringify(updatedGroup));
  } catch (error: any) {
    console.error('Error updating consecutive group:', error);
    return { error: error.message || 'Failed to update consecutive group' };
  }
}

/**
 * Deletes a consecutive group by its ID.
 * @param {string} groupId - The ID of the group to delete.
 * @returns {Promise<object>} A success message or an error object.
 */
export async function deleteConsecutiveGroup(groupId) {
  await dbConnect();
  try {
    const deletedGroup = await ConsecutiveGroup.findByIdAndDelete(groupId);
    if (!deletedGroup) {
      return { message: 'Consecutive group not found', success: false };
    }
    revalidatePath('/seat-groups');
    return { message: 'Consecutive group deleted successfully', success: true, deletedGroup: JSON.parse(JSON.stringify(deletedGroup)) };
  } catch (error: any) {
    console.error('Error deleting consecutive group:', error);
    return { error: error.message || 'Failed to delete consecutive group', success: false };
  }
}

/**
 * Retrieves consecutive groups by eventId.
 * @param {string} eventId - The eventId to filter groups by.
 * @returns {Promise<Array<object>>} An array of group objects or an error object.
 */
export async function getConsecutiveGroupsByEventId(eventId) {
  await dbConnect();
  try {
    const groups = await ConsecutiveGroup.find({ eventId: eventId });
    return JSON.parse(JSON.stringify(groups));
  } catch (error: any) {
    console.error('Error fetching consecutive groups by eventId:', error);
    return { error: error.message || 'Failed to fetch groups for event' };
  }
}

/**
 * Retrieves consecutive groups with pagination and optional search.
 */
export async function getConsecutiveGroupsPaginated(limit: number = 20, page: number = 1, searchTerm: string = '') {
  await dbConnect();
  try {
    const query: any = {};
    if (searchTerm) {
      const regex = new RegExp(searchTerm, 'i');
      query.$or = [
        { section: regex },
        { row: regex },
        { mapping_id: regex },
        { event_name: regex },
        { venue_name: regex },
      ];
    }
    const total = await ConsecutiveGroup.countDocuments(query);
    const qtyAgg = await ConsecutiveGroup.aggregate([
      { $match: query },
      { $group: { _id: null, seats: { $sum: "$inventory.quantity" } } },
    ]);
    const totalQuantity = qtyAgg[0]?.seats || 0;

    const groups = await ConsecutiveGroup.find(query)
      .skip((page - 1) * limit)
      .limit(limit);
    return { groups: JSON.parse(JSON.stringify(groups)), total, totalQuantity };
  } catch (error: any) {
    console.error('Error fetching paginated consecutive groups:', error);
    return { error: error.message || 'Failed to fetch paginated groups' };
  }
}
