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
      SELECT id, device_id, temperature, humidity, weight, medicine_present, battery, door_open, created_at 
      FROM telemetry_history 
      ORDER BY id DESC LIMIT ${limit}
    `;

    const formatted = rows.map((item: any) => {
      const weightVal = Number(item.weight ?? 50.0);
      const medicinePresent = item.medicine_present !== undefined && item.medicine_present !== null
        ? Boolean(item.medicine_present)
        : weightVal > 0;

      return {
        id: item.id,
        deviceId: item.device_id || 'ESP32-001',
        temperature: Number(item.temperature),
        humidity: Number(item.humidity),
        weight: weightVal,
        medicinePresent,
        battery: Number(item.battery ?? 98),
        doorOpen: Boolean(item.door_open),
        timestamp: item.created_at ? new Date(item.created_at).toISOString() : new Date().toISOString()
      };
    });

    return response.status(200).json(formatted);
  } catch (error: any) {
    console.error('Error fetching telemetry history:', error);
    return response.status(500).json({ error: error?.message || 'Database error' });
  }
}
