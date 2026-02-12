import { NextRequest, NextResponse } from 'next/server';
import { generateInventoryCsv, uploadCsvToSyncService } from '../../../actions/csvActions';

// Set maxDuration for this API route to handle large CSV operations
export const maxDuration = 300; // 5 minutes

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { eventUpdateFilterMinutes = 0 } = body;
    
    console.log('Starting manual CSV generation and upload...');
    
    // Generate CSV on server side
    const generateResult = await generateInventoryCsv(eventUpdateFilterMinutes);
    
    if (!generateResult.success || !generateResult.csv) {
      console.error('CSV generation failed:', generateResult.message);
      return NextResponse.json({ 
        success: false, 
        message: generateResult.message || 'Failed to generate CSV'
      }, { status: 400 });
    }

    console.log(`CSV generated successfully: ${generateResult.recordCount} records`);
    
    // Upload CSV directly to sync service (server-side)
    const uploadResult = await uploadCsvToSyncService(generateResult.csv);
    
    if (uploadResult.success) {
      console.log('CSV uploaded to sync service successfully');
      return NextResponse.json({
        success: true,
        message: 'CSV generated and uploaded to sync service successfully',
        recordCount: generateResult.recordCount,
        generationTime: generateResult.generationTime,
        uploadId: uploadResult.uploadId
      });
    } else {
      console.error('CSV upload failed:', uploadResult.message);
      return NextResponse.json({
        success: false,
        message: `CSV generation succeeded but upload failed: ${uploadResult.message}`,
        recordCount: generateResult.recordCount,
        generationTime: generateResult.generationTime
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error in export CSV API:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Internal server error during CSV export' 
    }, { status: 500 });
  }
}