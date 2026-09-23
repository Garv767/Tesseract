import { neon } from '@neondatabase/serverless';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  // CORS & Preflight handling
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
      return response.status(500).json({
        error: 'DATABASE_URL environment variable is missing on Vercel. Please add DATABASE_URL to your Vercel Project Settings > Environment Variables and redeploy.'
      });
    }

    const sql = neon(dbUrl);
    
    // 1. Fetch latest telemetry
    let telemetry: any = {
      temperature: 24.0, humidity: 48.0, weight: 50.0, battery: 98, door_open: false
    };
    try {
      const telemetryQuery = await sql`SELECT * FROM telemetry_history ORDER BY id DESC LIMIT 1`;
      if (telemetryQuery && telemetryQuery.length > 0) {
        telemetry = telemetryQuery[0];
      }
    } catch (e) {
      console.warn('Could not read telemetry_history:', e);
    }

    // 2. Fetch compartments
    let compartments: Record<string, any> = {};
    let medications: any[] = [];
    try {
      medications = await sql`SELECT * FROM medications`;
      medications.forEach((med: any) => {
        compartments[med.compartment_id] = {
          medicineName: med.name,
          present: Number(telemetry.weight) > 0,
          weight: med.expected_weight
        };
      });
    } catch (e) {
      console.warn('Could not read medications:', e);
    }

    // 3. Fetch dose history
    let history: any[] = [];
    try {
      history = await sql`SELECT * FROM dose_history ORDER BY id DESC LIMIT 20`;
    } catch (e) {
      console.warn('Could not read dose_history:', e);
    }

    // 4. Fetch system events
    let events: any[] = [];
    try {
      events = await sql`SELECT * FROM system_events ORDER BY id DESC LIMIT 20`;
    } catch (e) {
      console.warn('Could not read system_events:', e);
    }

    // 5. Fetch recent telemetry points for chart hydration
    let recentTelemetry: any[] = [];
    try {
      recentTelemetry = await sql`SELECT temperature, humidity, weight, created_at FROM telemetry_history ORDER BY id DESC LIMIT 30`;
    } catch (e) {
      console.warn('Could not read recent telemetry:', e);
    }

    const tempVal = Number(telemetry.temperature ?? 24.0);
    const humVal = Number(telemetry.humidity ?? 48.0);
    const weightVal = Number(telemetry.weight ?? 50.0);

    return response.status(200).json({
      deviceId: 'MED-ESP32-001',
      temperature: tempVal,
      humidity: humVal,
      weight: weightVal,
      battery: telemetry.battery ?? 98,
      doorOpen: Boolean(telemetry.door_open),
      wifiConnected: true,
      rtcSynchronized: true,
      sensorsOnline: true,
      medicinePresent: weightVal > 0,
      currentSimulationTime: new Date().toISOString(),
      compartments,
      medicationSchedule: medications,
      doseHistory: history,
      events,
      recentTelemetry: recentTelemetry.reverse()
    });
  } catch (error: any) {
    console.error('Error fetching state:', error);
    return response.status(500).json({ 
      error: error?.message || 'Database connection error',
      details: String(error)
    });
  }
}
