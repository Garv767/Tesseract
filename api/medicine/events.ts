import { neon } from '@neondatabase/serverless';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  try {
    const rawDbUrl = process.env.DATABASE_URL || '';
    const dbUrl = rawDbUrl.replace(/^["']|["']$/g, '').trim();

    if (!dbUrl) {
      return response.status(500).json({ error: 'DATABASE_URL environment variable is missing.' });
    }

    const limit = Math.min(Math.max(Number(request.query.limit || 50), 1), 200);

    const sql = neon(dbUrl);
    const rows = await sql`
      SELECT id, device_id, compartment_id, event, timestamp 
      FROM medicine_events 
      ORDER BY id DESC LIMIT ${limit}
    `;

    const formatted = rows.map((item: any) => ({
      id: item.id,
      deviceId: item.device_id || 'ESP32-001',
      compartmentId: item.compartment_id,
      event: item.event,
      timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString()
    }));

    return response.status(200).json(formatted);
  } catch (error: any) {
    console.error('Error fetching medicine events:', error);
    return response.status(500).json({ error: error?.message || 'Database error' });
  }
}
