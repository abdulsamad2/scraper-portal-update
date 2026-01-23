import { NextResponse } from 'next/server';
import { clearInventoryFromSync } from '../../../actions/csvActions';

// Force dynamic rendering - no caching
export const dynamic = 'force-dynamic';

export async function POST() {
  const noCacheHeaders = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  };

  try {
    console.log('Starting inventory clear process...');
    
    const result = await clearInventoryFromSync();
    
    if (result.success) {
      console.log('Inventory cleared successfully');
      return NextResponse.json({
        success: true,
        message: result.message,
        uploadId: result.uploadId
      }, { headers: noCacheHeaders });
    } else {
      console.error('Failed to clear inventory:', result.message);
      return NextResponse.json({
        success: false,
        message: result.message
      }, { status: 500, headers: noCacheHeaders });
    }
  } catch (error) {
    console.error('Error in clear inventory API:', error);
    return NextResponse.json({
      success: false,
      message: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`
    }, { status: 500, headers: noCacheHeaders });
  }
}