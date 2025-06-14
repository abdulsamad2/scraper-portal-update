import { NextApiRequest, NextApiResponse } from 'next';
import { clearInventoryFromSync } from '../../actions/csvActions';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    console.log('Starting inventory clear process...');
    
    const result = await clearInventoryFromSync();
    
    if (result.success) {
      console.log('Inventory cleared successfully');
      return res.status(200).json({
        success: true,
        message: result.message,
        uploadId: result.uploadId
      });
    } else {
      console.error('Failed to clear inventory:', result.message);
      return res.status(500).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    console.error('Error in clear inventory API:', error);
    return res.status(500).json({
      success: false,
      message: `Internal server error: ${error.message}`
    });
  }
}