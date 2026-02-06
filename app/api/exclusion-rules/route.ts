import { NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { ExclusionRules } from '@/models/exclusionRulesModel';

export async function GET() {
  try {
    await dbConnect();
    
    const exclusionRules = await ExclusionRules.find({ isActive: true })
      .sort({ lastUpdated: -1 })
      .lean();

    // Convert MongoDB documents to plain objects
    const plainRules = JSON.parse(JSON.stringify(exclusionRules));

    return NextResponse.json(plainRules);
  } catch (error) {
    console.error('Error fetching exclusion rules:', error);
    return NextResponse.json(
      { error: 'Failed to fetch exclusion rules' },
      { status: 500 }
    );
  }
}