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

    const sql = neon(dbUrl);
    const telemetryQuery = await sql`
      SELECT id, device_id, temperature, humidity, weight, medicine_present, battery, door_open, created_at 
      FROM telemetry_history 
      ORDER BY id DESC LIMIT 1
    `;

    if (!telemetryQuery || telemetryQuery.length === 0) {
      return response.status(200).json({
        deviceId: 'ESP32-001',
        temperature: 24.0,
        humidity: 48.0,
        weight: 50.0,
        medicinePresent: true,
        battery: 98,
        doorOpen: false,
        timestamp: new Date().toISOString()
      });
    }

    const item = telemetryQuery[0];
    const weightVal = Number(item.weight ?? 50.0);
    const medicinePresent = item.medicine_present !== undefined && item.medicine_present !== null
      ? Boolean(item.medicine_present)
      : weightVal > 0;

    return response.status(200).json({
      deviceId: item.device_id || 'ESP32-001',
      temperature: Number(item.temperature ?? 24.0),
      humidity: Number(item.humidity ?? 48.0),
      weight: weightVal,
      medicinePresent,
      battery: item.battery !== undefined ? Number(item.battery) : 98,
      doorOpen: Boolean(item.door_open),
      timestamp: item.created_at ? new Date(item.created_at).toISOString() : new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error fetching latest telemetry:', error);
    return response.status(500).json({ error: error?.message || 'Database error' });
  }
}
