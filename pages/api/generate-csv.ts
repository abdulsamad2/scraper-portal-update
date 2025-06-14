import { NextApiRequest, NextApiResponse } from 'next';
import { generateInventoryCsv } from '../../actions/csvActions';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    console.log('Starting manual CSV generation...');
    const result = await generateInventoryCsv();
    
    if (result.success) {
      console.log(`Manual CSV generation completed: ${result.recordCount} records in ${result.generationTime}ms`);
      return res.status(200).json(result);
    } else {
      console.error('Manual CSV generation failed:', result.message);
      return res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in manual CSV generation API:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error during CSV generation' 
    });
  }
}