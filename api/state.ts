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
    let telemetry: any = null;
    try {
      const telemetryQuery = await sql`SELECT * FROM telemetry_history ORDER BY id DESC LIMIT 1`;
      if (telemetryQuery && telemetryQuery.length > 0) {
        telemetry = telemetryQuery[0];
      }
    } catch (e) {
      console.warn('Could not read telemetry_history:', e);
    }

    // Determine actual hardware connectivity based on telemetry timestamp
    // ESP32 reports every 10s. If last ping is > 40s ago, device is OFFLINE.
    const lastSeenTime = telemetry?.created_at ? new Date(telemetry.created_at).getTime() : 0;
    const now = Date.now();
    const diffSeconds = lastSeenTime > 0 ? Math.max(0, Math.floor((now - lastSeenTime) / 1000)) : 999999;
    const isDeviceOnline = lastSeenTime > 0 && diffSeconds <= 40;

    // 2. Fetch compartments
    let compartments: Record<string, any> = {};
    let medications: any[] = [];
    try {
      medications = await sql`SELECT * FROM medications`;
      medications.forEach((med: any) => {
        compartments[med.compartment_id] = {
          medicineName: med.name,
          present: telemetry ? Boolean(telemetry.medicine_present) : false,
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

    // 4. Fetch system events & medicine events
    let events: any[] = [];
    try {
      events = await sql`SELECT * FROM system_events ORDER BY id DESC LIMIT 20`;
    } catch (e) {
      console.warn('Could not read system_events:', e);
    }

    let medicineEvents: any[] = [];
    try {
      medicineEvents = await sql`SELECT * FROM medicine_events ORDER BY id DESC LIMIT 20`;
    } catch (e) {
      console.warn('Could not read medicine_events:', e);
    }

    // 5. Fetch recent telemetry points for chart hydration
    let recentTelemetry: any[] = [];
    try {
      recentTelemetry = await sql`
        SELECT temperature, humidity, weight, medicine_present, created_at 
        FROM telemetry_history 
        ORDER BY id DESC LIMIT 30
      `;
    } catch (e) {
      console.warn('Could not read recent telemetry:', e);
    }

    const tempVal = telemetry ? Number(telemetry.temperature ?? 0) : 0;
    const humVal = telemetry ? Number(telemetry.humidity ?? 0) : 0;
    const weightVal = telemetry ? Number(telemetry.weight ?? 0) : 0;
    const isMedicinePresent = telemetry?.medicine_present !== undefined && telemetry?.medicine_present !== null
      ? Boolean(telemetry.medicine_present) 
      : false;
    const deviceId = telemetry?.device_id || 'ESP32-001';

    return response.status(200).json({
      deviceId,
      temperature: tempVal,
      humidity: humVal,
      weight: weightVal,
      battery: telemetry ? Number(telemetry.battery ?? 0) : 0,
      doorOpen: Boolean(telemetry?.door_open),
      wifiConnected: isDeviceOnline,
      rtcSynchronized: isDeviceOnline,
      sensorsOnline: isDeviceOnline,
      isDeviceOnline,
      lastSeenSecondsAgo: diffSeconds,
      lastSeenAt: telemetry?.created_at || null,
      medicinePresent: isMedicinePresent,
      currentSimulationTime: new Date().toISOString(),
      compartments,
      medicationSchedule: medications,
      doseHistory: history,
      events,
      medicineEvents,
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
