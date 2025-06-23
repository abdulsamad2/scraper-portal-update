'use server';

import dbConnect from '@/lib/dbConnect';
import { ConsecutiveGroup } from '@/models/seatModel'; // Assuming models are aliased to @/models

import { UpdateQuery } from 'mongoose';
import { revalidatePath } from 'next/cache';

/**
 * Creates a new consecutive seat group.
 * @param {object} groupData - The data for the new group.
 * @returns {Promise<object>} The created group object or an error object.
 */
export async function createConsecutiveGroup(groupData: {
  section: string;
  row: string;
  mapping_id: string;
  event_name: string;
  venue_name: string;
  eventId: string;
  inventory: {
    quantity: number;
    seats: string[];
  };
}) {
  await dbConnect();
  try {
    const newGroup = new ConsecutiveGroup(groupData);
    const savedGroup = await newGroup.save();
    revalidatePath('/seat-groups'); // Adjust path as needed
    revalidatePath(`/seat-groups/${savedGroup._id}`);
    return JSON.parse(JSON.stringify(savedGroup));
  } catch (error: unknown) {
    console.error('Error creating consecutive group:', error);
    return { error: error instanceof Error ? error.message : 'Failed to create consecutive group' };
  }
}

/**
 * Retrieves all consecutive groups with pagination and optimization.
 * @param {number} limit - Optional limit for number of results
 * @param {number} skip - Optional number of results to skip
 * @returns {Promise<Array<object>>} An array of group objects or an error object.
 */
export async function getAllConsecutiveGroups(limit?: number, skip?: number) {
  await dbConnect();
  try {
    let query = ConsecutiveGroup.find({});
    
    // Add lean() for better performance - returns plain JS objects instead of Mongoose documents
    query = query.lean();
    
    // Add pagination if provided
    if (skip !== undefined) {
      query = query.skip(skip);
    }
    // Set default limit to 100 if not provided
    const resultLimit = limit !== undefined ? limit : 100;
    query = query.limit(resultLimit);
    
    const groups = await query;
    return JSON.parse(JSON.stringify(groups));
  } catch (error: unknown) {
    console.error('Error fetching all consecutive groups:', error);
    return { error: error instanceof Error ? error.message : 'Failed to fetch consecutive groups' };
  }
}

/**
 * Retrieves a single consecutive group by its ID.
 * @param {string} groupId - The ID of the group to retrieve.
 * @returns {Promise<object|null>} The group object or null if not found, or an error object.
 */
export async function getConsecutiveGroupById(groupId: string) {
  await dbConnect();
  try {
    const group = await ConsecutiveGroup.findById(groupId);
    if (!group) {
      return null;
    }
    return JSON.parse(JSON.stringify(group));
  } catch (error: Error | unknown) {
    console.error('Error fetching consecutive group by ID:', error);
    return { error:'Failed to fetch consecutive group' };
  }
}

/**
 * Updates an existing consecutive group.
 * @param {string} groupId - The ID of the group to update.
 * @param {object} updateData - An object containing the fields to update.
 * @returns {Promise<object|null>} The updated group object or null if not found, or an error object.
 */
export async function updateConsecutiveGroup(groupId: string, updateData: UpdateQuery<typeof ConsecutiveGroup> | undefined) {
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
  } catch (error: unknown) {
    console.error('Error updating consecutive group:', error);
    return { error: error instanceof Error ? error.message : 'Failed to update consecutive group' };
  }
}

/**
 * Deletes a consecutive group by its ID.
 * @param {string} groupId - The ID of the group to delete.
 * @returns {Promise<object>} A success message or an error object.
 */
export async function deleteConsecutiveGroup(groupId: string) {
  await dbConnect();
  try {
    const deletedGroup = await ConsecutiveGroup.findByIdAndDelete(groupId);
    if (!deletedGroup) {
      return { message: 'Consecutive group not found', success: false };
    }
    revalidatePath('/seat-groups');
    return { message: 'Consecutive group deleted successfully', success: true, deletedGroup: JSON.parse(JSON.stringify(deletedGroup)) };
  } catch (error: unknown) {
    console.error('Error deleting consecutive group:', error);
    return { error: error instanceof Error ? error.message : 'Failed to delete consecutive group', success: false };
  }
}

/**
 * Retrieves consecutive groups by eventId.
 * @param {string} eventId - The eventId to filter groups by.
 * @returns {Promise<Array<object>>} An array of group objects or an error object.
 */
export async function getConsecutiveGroupsByEventId(eventId: string) {
  await dbConnect();
  try {
    const groups = await ConsecutiveGroup.find({ eventId: eventId });
    return JSON.parse(JSON.stringify(groups));
  } catch (error: unknown) {
    console.error('Error fetching consecutive groups by eventId:', error);
    return { error: error instanceof Error ? error.message : 'Failed to fetch groups for event' };
  }
}

/**
 * Retrieves consecutive groups with pagination and optional search.
 */
interface FilterOptions {
  event?: string;
  mapping?: string;
  section?: string;
  row?: string;
}

export async function getConsecutiveGroupsPaginated(
  limit: number = 50, 
  page: number = 1, 
  searchTerm: string = '',
  filters?: FilterOptions
) {
  await dbConnect();
  try {
    const query: Record<string, unknown> = {};
    const conditions: Record<string, unknown>[] = [];
    
    // Handle general search term
    if (searchTerm) {
      const regex = new RegExp(searchTerm, 'i');
      conditions.push({
        $or: [
          { section: regex },
          { row: regex },
          { mapping_id: regex },
          { event_name: regex },
          { venue_name: regex },
        ]
      });
    }
    
    // Handle specific filters
    if (filters) {
      if (filters.event) {
        const regex = new RegExp(filters.event, 'i');
        conditions.push({ event_name: regex });
      }
      if (filters.mapping) {
        const regex = new RegExp(filters.mapping, 'i');
        conditions.push({ mapping_id: regex });
      }
      if (filters.section) {
        const regex = new RegExp(filters.section, 'i');
        conditions.push({ section: regex });
      }
      if (filters.row) {
        const regex = new RegExp(filters.row, 'i');
        conditions.push({ row: regex });
      }
    }
    
    // Combine all conditions
    if (conditions.length > 0) {
      query.$and = conditions;
    }
    const total = await ConsecutiveGroup.countDocuments(query);
    const qtyAgg = await ConsecutiveGroup.aggregate([
      { $match: query },
      { $group: { _id: null, seats: { $sum: "$inventory.quantity" } } },
    ]);
    const totalQuantity = qtyAgg[0]?.seats || 0;

    // Fetch groups for this page
    const groups = await ConsecutiveGroup.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Serialize the data to ensure it's a plain object for client components.
    // This converts ObjectIds, Dates, etc., to strings.
    const plainGroups = JSON.parse(JSON.stringify(groups));

    return { groups: plainGroups, total, totalQuantity };
  } catch (error: Error | unknown) {
    console.error('Error fetching paginated consecutive groups:', error);
    return { error: error instanceof Error ? error.message : 'Failed to fetch paginated groups' };
  }
}
