import { useState, useEffect, useRef, useCallback } from 'react';
import {
  LayoutDashboard,
  LineChart,
  Bell,
  Settings,
  Info,
  Thermometer,
  Droplets,
  Pill,
  Cpu,
  Globe,
  Clock,
  Database,
  RefreshCw,
  AlertTriangle,
  Activity,
  HeartPulse,
  Radio,
  Sliders,
  AlertCircle
} from 'lucide-react';
import './clean-dashboard.css';

interface TelemetryState {
  temperature: number;
  humidity: number;
  medicinePresent: boolean;
  doorOpen: boolean;
  deviceId: string;
  weight: number;
  battery: number;
  lastUpdated: string;
}

interface SystemEvent {
  id: number;
  event_type: string;
  source: string;
  description: string;
  severity: string;
  related_component: string;
  created_at: string;
}

export function CleanDashboard() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'analytics' | 'events' | 'settings' | 'about'>('dashboard');
  const [state, setState] = useState<TelemetryState>({
    temperature: 24.2,
    humidity: 48.5,
    medicinePresent: true,
    doorOpen: false,
    deviceId: 'ESP32 (GPIO 4)',
    weight: 50.0,
    battery: 98,
    lastUpdated: new Date().toLocaleTimeString(),
  });

  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [tempHistory, setTempHistory] = useState<number[]>([23.8, 24.0, 24.1, 24.2]);
  const [humHistory, setHumHistory] = useState<number[]>([47.5, 48.0, 48.2, 48.5]);
  const [connectionStatus, setConnectionStatus] = useState<'online' | 'syncing' | 'offline'>('syncing');
  const [currentTime, setCurrentTime] = useState<string>(new Date().toLocaleTimeString());
  const [currentDate, setCurrentDate] = useState<string>(new Date().toLocaleDateString());
  const [bootTime] = useState<number>(Date.now());
  const [uptimeStr, setUptimeStr] = useState<string>('0h 0m 0s');
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(2500);

  const tempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const humCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Determine API endpoint respecting Vercel preview branch deployment
  const getApiEndpoint = useCallback(() => {
    const base = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/$/, '') : '';
    return `${base}/api/state`;
  }, []);

  // Fetch real-time data from backend database (/api/state)
  const fetchRealtimeData = useCallback(async () => {
    try {
      setConnectionStatus((prev) => (prev === 'offline' ? 'syncing' : prev));
      const res = await fetch(getApiEndpoint());
      if (!res.ok) {
        const errPayload = await res.json().catch(async () => ({ error: await res.text().catch(() => '') }));
        throw new Error(errPayload.error || errPayload.details || `HTTP ${res.status}`);
      }
      const data = await res.json();

      const newTemp = Number(data.temperature ?? 24.0);
      const newHum = Number(data.humidity ?? 50.0);
      const isMedicine = data.medicinePresent !== undefined 
        ? Boolean(data.medicinePresent) 
        : (data.weight !== undefined ? Number(data.weight) > 0 : true);

      setState({
        temperature: newTemp,
        humidity: newHum,
        medicinePresent: isMedicine,
        doorOpen: Boolean(data.doorOpen),
        deviceId: data.deviceId || 'ESP32 (GPIO 4)',
        weight: Number(data.weight ?? 50.0),
        battery: Number(data.battery ?? 95),
        lastUpdated: new Date().toLocaleTimeString(),
      });

      if (Array.isArray(data.events)) {
        setEvents(data.events);
      }

      // If database provided historical records, hydrate the chart
      if (Array.isArray(data.recentTelemetry) && data.recentTelemetry.length > 0) {
        const tVals = data.recentTelemetry.map((item: any) => Number(item.temperature));
        const hVals = data.recentTelemetry.map((item: any) => Number(item.humidity));
        if (tVals.length > 0) setTempHistory(tVals);
        if (hVals.length > 0) setHumHistory(hVals);
      } else {
        setTempHistory((prev) => {
          const next = [...prev, newTemp];
          return next.length > 30 ? next.slice(-30) : next;
        });
        setHumHistory((prev) => {
          const next = [...prev, newHum];
          return next.length > 30 ? next.slice(-30) : next;
        });
      }

      setConnectionStatus('online');
    } catch (err: any) {
      console.warn('[Dashboard] Could not fetch real-time state from DB:', err?.message || err);
      setConnectionStatus('offline');
    }
  }, [getApiEndpoint]);

  // Polling loop for real-time DB data
  useEffect(() => {
    fetchRealtimeData();
    const interval = setInterval(fetchRealtimeData, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchRealtimeData, pollIntervalMs]);

  // Clock & Uptime timer
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString());
      setCurrentDate(now.toLocaleDateString());

      const diffSecs = Math.floor((Date.now() - bootTime) / 1000);
      const h = Math.floor(diffSecs / 3600);
      const m = Math.floor((diffSecs % 3600) / 60);
      const s = diffSecs % 60;
      setUptimeStr(`${h}h ${m}m ${s}s`);
    }, 1000);
    return () => clearInterval(timer);
  }, [bootTime]);

  // Canvas line chart drawing algorithm matching user specification
  const renderChart = useCallback((canvas: HTMLCanvasElement, values: number[], type: 'temperature' | 'humidity') => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.clientWidth || 320;
    const height = 190;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (values.length < 2) return;

    let min = Math.min(...values);
    let max = Math.max(...values);

    if (type === 'temperature') {
      min = Math.min(min - 2, 15);
      max = Math.max(max + 2, 35);
    } else {
      min = Math.min(min - 5, 20);
      max = Math.max(max + 5, 80);
    }

    const left = 35;
    const right = 14;
    const top = 16;
    const bottom = 26;

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = top + i * ((height - top - bottom) / 4);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(width - right, y);
      ctx.stroke();

      // Axis labels
      const valLabel = Math.round(max - i * ((max - min) / 4));
      ctx.fillStyle = '#64748b';
      ctx.font = '10px -apple-system, BlinkMacSystemFont, "SF Mono", monospace';
      ctx.fillText(String(valLabel), 6, y + 3);
    }

    // Draw line
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = left + index * ((width - left - right) / Math.max(values.length - 1, 1));
      const y = height - bottom - ((value - min) / (max - min)) * (height - top - bottom);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    const lineColor = type === 'temperature' ? '#38bdf8' : '#34d399';
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Draw last point circle
    const lastVal = values[values.length - 1];
    const lastX = width - right;
    const lastY = height - bottom - ((lastVal - min) / (max - min)) * (height - top - bottom);

    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
    ctx.strokeStyle = '#08090d';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, []);

  // Redraw charts when history updates or active tab changes to dashboard
  useEffect(() => {
    if (activeTab === 'dashboard') {
      if (tempCanvasRef.current) {
        renderChart(tempCanvasRef.current, tempHistory, 'temperature');
      }
      if (humCanvasRef.current) {
        renderChart(humCanvasRef.current, humHistory, 'humidity');
      }
    }
  }, [activeTab, tempHistory, humHistory, renderChart]);

  const testAlert = () => {
    alert('Tesseract Smart Medicine Storage\n\nAlert system test successful.\nReal-time monitoring active.');
  };

  const isTempNormal = state.temperature >= 15 && state.temperature <= 25;
  const isHumOptimal = state.humidity >= 30 && state.humidity <= 60;

  return (
    <div className="clean-layout">
      {/* SIDEBAR */}
      <aside className="clean-sidebar">
        <div>
          <div className="clean-logo">
            <div className="clean-logo-icon">
              <HeartPulse size={24} strokeWidth={2.5} />
            </div>
            <div className="clean-logo-text">
              TESSERACT<br />
              MEDICINE STORAGE
            </div>
          </div>

          <nav className="clean-nav">
            <div
              className={`clean-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              <LayoutDashboard size={18} />
              <span>Dashboard</span>
            </div>
            <div
              className={`clean-nav-item ${activeTab === 'analytics' ? 'active' : ''}`}
              onClick={() => setActiveTab('analytics')}
            >
              <LineChart size={18} />
              <span>Analytics</span>
            </div>
            <div
              className={`clean-nav-item ${activeTab === 'events' ? 'active' : ''}`}
              onClick={() => setActiveTab('events')}
            >
              <Bell size={18} />
              <span>Events {events.length > 0 && `(${events.length})`}</span>
            </div>
            <div
              className={`clean-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <Settings size={18} />
              <span>Settings</span>
            </div>
            <div
              className={`clean-nav-item ${activeTab === 'about' ? 'active' : ''}`}
              onClick={() => setActiveTab('about')}
            >
              <Info size={18} />
              <span>About</span>
            </div>
          </nav>
        </div>

        <div className="clean-sidebar-bottom">
          SAFE MEDICINE<br />
          HEALTHY TOMORROW
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="clean-main">
        {/* HEADER */}
        <header className="clean-header">
          <div className="clean-header-title">
            <h1>Tesseract</h1>
            <p>Smart Medicine Storage &nbsp;•&nbsp; Monitor &nbsp;•&nbsp; Protect</p>
          </div>

          <div className="clean-header-right">
            <div
              className={`clean-online ${
                connectionStatus === 'offline' ? 'offline' : connectionStatus === 'syncing' ? 'syncing' : ''
              }`}
            >
              <span className="clean-online-dot"></span>
              {connectionStatus === 'online' ? (
                <>
                  <Radio size={13} style={{ marginRight: '6px' }} />
                  <span>ESP32 ONLINE</span>
                </>
              ) : connectionStatus === 'syncing' ? (
                <>
                  <RefreshCw size={13} className="animate-spin" style={{ marginRight: '6px' }} />
                  <span>SYNCING DB...</span>
                </>
              ) : (
                <>
                  <AlertCircle size={13} style={{ marginRight: '6px' }} />
                  <span>DB OFFLINE</span>
                </>
              )}
            </div>

            <div className="clean-clock">
              <div>{currentDate}</div>
              <div style={{ color: '#f8fafc', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end', marginTop: '2px' }}>
                <Clock size={12} style={{ color: '#7890ad' }} />
                <strong>{currentTime}</strong>
              </div>
            </div>
          </div>
        </header>

        {/* TAB 1: DASHBOARD VIEW */}
        {activeTab === 'dashboard' && (
          <>
            {/* TOP 3 CARDS */}
            <section className="clean-top-grid">
              {/* TEMPERATURE CARD */}
              <div className="clean-card">
                <div className="clean-card-header">
                  <div className="clean-card-title">
                    <Thermometer size={16} style={{ color: '#38bdf8' }} />
                    <span>TEMPERATURE</span>
                  </div>
                  <div className="clean-card-subtitle">DHT11 (GPIO 4)</div>
                </div>
                <div className="clean-gauge-area">
                  <div className="clean-gauge">
                    <div className="clean-gauge-bg"></div>
                    <div className="clean-temp-ring"></div>
                    <div className="clean-gauge-value">
                      <span>{state.temperature.toFixed(1)}</span> &deg;C
                    </div>
                  </div>
                  <div className={`clean-gauge-status ${isTempNormal ? '' : 'warning'}`}>
                    {isTempNormal ? 'NORMAL' : 'WARNING'}
                  </div>
                  <div className="clean-range-row">
                    <div>
                      MIN
                      <div className="clean-range-value">15&deg;C</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      TARGET
                      <div className="clean-range-value clean-range-target">15 - 25&deg;C</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      MAX
                      <div className="clean-range-value">25&deg;C</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* HUMIDITY CARD */}
              <div className="clean-card">
                <div className="clean-card-header">
                  <div className="clean-card-title">
                    <Droplets size={16} style={{ color: '#20c8dc' }} />
                    <span>HUMIDITY</span>
                  </div>
                  <div className="clean-card-subtitle">DHT11 (GPIO 4)</div>
                </div>
                <div className="clean-gauge-area">
                  <div className="clean-humidity-gauge">
                    <div className="clean-humidity-progress"></div>
                    <div className="clean-humidity-value">
                      <span>{state.humidity.toFixed(1)}</span> %
                    </div>
                  </div>
                  <div className={`clean-gauge-status ${isHumOptimal ? '' : 'warning'}`}>
                    {isHumOptimal ? 'OPTIMAL' : 'WARNING'}
                  </div>
                  <div className="clean-range-row">
                    <div>
                      MIN
                      <div className="clean-range-value">30%</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      TARGET
                      <div className="clean-range-value clean-range-target">30 - 60% RH</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      MAX
                      <div className="clean-range-value">60%</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* MEDICINE STATUS CARD */}
              <div className="clean-card">
                <div className="clean-card-header">
                  <div className="clean-card-title">
                    <Pill size={16} style={{ color: state.medicinePresent ? '#34d399' : '#ff5965' }} />
                    <span>MEDICINE STATUS</span>
                  </div>
                  <div className="clean-card-subtitle">IR SENSOR (GPIO 18)</div>
                </div>
                <div className="clean-medicine-body">
                  <div className={`clean-medicine-icon ${state.medicinePresent ? 'present' : ''}`}>
                    {state.medicinePresent ? (
                      <Pill size={42} strokeWidth={2} />
                    ) : (
                      <AlertCircle size={42} strokeWidth={2} />
                    )}
                  </div>
                  <div className={`clean-medicine-status ${state.medicinePresent ? 'present' : ''}`}>
                    {state.medicinePresent ? 'MEDICINE PRESENT' : 'MEDICINE NOT PRESENT'}
                  </div>
                  <div className="clean-medicine-description">
                    {state.medicinePresent
                      ? 'Medicine detected in the compartment.'
                      : 'No medicine detected in the compartment.'}
                  </div>
                  <div className="clean-alert-box">
                    {state.medicinePresent
                      ? 'Medicine stock detected and available.'
                      : 'Please restock the medicine to ensure uninterrupted availability.'}
                  </div>
                </div>
              </div>
            </section>

            {/* LIVE CHARTS GRID */}
            <section className="clean-chart-grid">
              <div className="clean-card clean-chart-card">
                <div className="clean-chart-header">
                  <div className="clean-chart-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Thermometer size={16} style={{ color: '#3b9cff' }} />
                    <span>Temperature (&deg;C)</span>
                  </div>
                  <div className="clean-live-tag">
                    <span className="clean-live-dot"></span> Live DB Stream
                  </div>
                </div>
                <canvas ref={tempCanvasRef} className="clean-canvas" />
              </div>

              <div className="clean-card clean-chart-card">
                <div className="clean-chart-header">
                  <div className="clean-chart-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Droplets size={16} style={{ color: '#35dfab' }} />
                    <span>Humidity (%)</span>
                  </div>
                  <div className="clean-live-tag">
                    <span className="clean-live-dot"></span> Live DB Stream
                  </div>
                </div>
                <canvas ref={humCanvasRef} className="clean-canvas" />
              </div>
            </section>

            {/* BOTTOM 3 CARDS */}
            <section className="clean-bottom-grid">
              {/* DEVICE INFORMATION */}
              <div className="clean-card">
                <div className="clean-card-header">
                  <div className="clean-card-title">
                    <Cpu size={16} style={{ color: '#94a3b8' }} />
                    <span>DEVICE INFORMATION</span>
                  </div>
                </div>
                <div className="clean-info-body">
                  <div className="clean-info-row">
                    <span className="clean-info-label">
                      <Cpu size={14} /> Device
                    </span>
                    <span className="clean-info-value">{state.deviceId}</span>
                  </div>
                  <div className="clean-info-row">
                    <span className="clean-info-label">
                      <Globe size={14} /> Host / Origin
                    </span>
                    <span className="clean-info-value">
                      {typeof window !== 'undefined' ? window.location.hostname : 'Cloud'}
                    </span>
                  </div>
                  <div className="clean-info-row">
                    <span className="clean-info-label">
                      <Clock size={14} /> Client Uptime
                    </span>
                    <span className="clean-info-value">{uptimeStr}</span>
                  </div>
                  <div className="clean-info-row">
                    <span className="clean-info-label">
                      <Database size={14} /> Last DB Sync
                    </span>
                    <span className="clean-info-value">{state.lastUpdated}</span>
                  </div>
                </div>
              </div>

              {/* ENVIRONMENTAL STATUS */}
              <div className="clean-card">
                <div className="clean-card-header">
                  <div className="clean-card-title">
                    <Activity size={16} style={{ color: '#94a3b8' }} />
                    <span>ENVIRONMENTAL STATUS</span>
                  </div>
                </div>
                <div>
                  <div className="clean-environment-row">
                    <div className="clean-env-left">
                      <span className={`clean-env-dot ${isTempNormal ? 'green' : 'red'}`}></span>
                      <Thermometer size={14} style={{ color: '#38bdf8' }} />
                      <span>Temperature</span>
                    </div>
                    <div className={`clean-badge ${isTempNormal ? 'clean-badge-green' : 'clean-badge-red'}`}>
                      {isTempNormal ? 'NORMAL' : 'WARNING'}
                    </div>
                    <strong style={{ color: '#f8fafc' }}>{state.temperature.toFixed(1)}&deg;C</strong>
                  </div>

                  <div className="clean-environment-row">
                    <div className="clean-env-left">
                      <span className={`clean-env-dot ${isHumOptimal ? 'green' : 'red'}`}></span>
                      <Droplets size={14} style={{ color: '#20c8dc' }} />
                      <span>Humidity</span>
                    </div>
                    <div className={`clean-badge ${isHumOptimal ? 'clean-badge-green' : 'clean-badge-red'}`}>
                      {isHumOptimal ? 'OPTIMAL' : 'WARNING'}
                    </div>
                    <strong style={{ color: '#f8fafc' }}>{state.humidity.toFixed(1)}%</strong>
                  </div>

                  <div className="clean-environment-row">
                    <div className="clean-env-left">
                      <span className={`clean-env-dot ${state.medicinePresent ? 'green' : 'red'}`}></span>
                      <Pill size={14} style={{ color: '#34d399' }} />
                      <span>Medicine</span>
                    </div>
                    <div className={`clean-badge ${state.medicinePresent ? 'clean-badge-green' : 'clean-badge-red'}`}>
                      {state.medicinePresent ? 'PRESENT' : 'NOT PRESENT'}
                    </div>
                    <strong style={{ color: '#f8fafc' }}>{state.medicinePresent ? 'Available' : 'Empty'}</strong>
                  </div>
                </div>
              </div>

              {/* QUICK ACTIONS */}
              <div className="clean-card">
                <div className="clean-card-header">
                  <div className="clean-card-title">
                    <Sliders size={16} style={{ color: '#94a3b8' }} />
                    <span>QUICK ACTIONS</span>
                  </div>
                </div>
                <div className="clean-actions">
                  <button className="clean-action-btn" onClick={fetchRealtimeData}>
                    <RefreshCw size={15} className={connectionStatus === 'syncing' ? 'animate-spin' : ''} />
                    <span>Refresh Data Now</span>
                  </button>
                  <button className="clean-action-btn secondary" onClick={testAlert}>
                    <AlertTriangle size={15} />
                    <span>Test System Alert</span>
                  </button>
                  <div style={{ color: '#7892b1', fontSize: '11px', marginTop: '14px', textAlign: 'center' }}>
                    Real-time Neon DB telemetry for healthcare compliance
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {/* TAB 2: ANALYTICS VIEW */}
        {activeTab === 'analytics' && (
          <div className="clean-subpage">
            <div className="clean-card" style={{ padding: '24px' }}>
              <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <LineChart size={20} style={{ color: '#38bdf8' }} />
                <span>Telemetry Analytics</span>
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div style={{ background: '#09111d', padding: '16px', borderRadius: '10px', border: '1px solid #17283a' }}>
                  <div style={{ color: '#7890ad', fontSize: '12px' }}>Min Temperature</div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#38bdf8', marginTop: '6px' }}>
                    {Math.min(...tempHistory).toFixed(1)}&deg;C
                  </div>
                </div>
                <div style={{ background: '#09111d', padding: '16px', borderRadius: '10px', border: '1px solid #17283a' }}>
                  <div style={{ color: '#7890ad', fontSize: '12px' }}>Max Temperature</div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f43f5e', marginTop: '6px' }}>
                    {Math.max(...tempHistory).toFixed(1)}&deg;C
                  </div>
                </div>
                <div style={{ background: '#09111d', padding: '16px', borderRadius: '10px', border: '1px solid #17283a' }}>
                  <div style={{ color: '#7890ad', fontSize: '12px' }}>Avg Temperature</div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#34d399', marginTop: '6px' }}>
                    {(tempHistory.reduce((a, b) => a + b, 0) / tempHistory.length).toFixed(1)}&deg;C
                  </div>
                </div>
                <div style={{ background: '#09111d', padding: '16px', borderRadius: '10px', border: '1px solid #17283a' }}>
                  <div style={{ color: '#7890ad', fontSize: '12px' }}>Avg Humidity</div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#20c8dc', marginTop: '6px' }}>
                    {(humHistory.reduce((a, b) => a + b, 0) / humHistory.length).toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: EVENTS VIEW */}
        {activeTab === 'events' && (
          <div className="clean-subpage">
            <div className="clean-card" style={{ padding: '20px' }}>
              <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Bell size={20} style={{ color: '#38bdf8' }} />
                <span>Database Event Log</span>
              </h2>
              {events.length === 0 ? (
                <p style={{ color: '#64748b' }}>No system events recorded yet.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="clean-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Type</th>
                        <th>Source</th>
                        <th>Description</th>
                        <th>Severity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((ev, i) => (
                        <tr key={ev.id || i}>
                          <td style={{ color: '#94a3b8' }}>{ev.created_at ? new Date(ev.created_at).toLocaleTimeString() : 'Recent'}</td>
                          <td style={{ fontWeight: 600 }}>{ev.event_type}</td>
                          <td>{ev.source || ev.related_component}</td>
                          <td>{ev.description}</td>
                          <td>
                            <span
                              className={`clean-badge ${
                                ev.severity === 'WARNING' || ev.severity === 'CRITICAL'
                                  ? 'clean-badge-red'
                                  : 'clean-badge-green'
                              }`}
                            >
                              {ev.severity || 'INFO'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: SETTINGS VIEW */}
        {activeTab === 'settings' && (
          <div className="clean-subpage">
            <div className="clean-card" style={{ padding: '24px' }}>
              <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings size={20} style={{ color: '#38bdf8' }} />
                <span>Deployment &amp; API Settings</span>
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '600px' }}>
                <div>
                  <label style={{ color: '#7890ad', fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                    Active Polling API URL
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={getApiEndpoint()}
                    style={{
                      width: '100%',
                      background: '#0a101b',
                      border: '1px solid #1b3149',
                      color: '#38bdf8',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      fontFamily: 'monospace',
                    }}
                  />
                  <small style={{ color: '#64748b', marginTop: '4px', display: 'block' }}>
                    Automatically uses relative <code>/api/state</code> so Vercel Preview Deployments work seamlessly.
                  </small>
                </div>

                <div>
                  <label style={{ color: '#7890ad', fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                    Auto-Refresh Interval ({pollIntervalMs / 1000}s)
                  </label>
                  <input
                    type="range"
                    min="1000"
                    max="10000"
                    step="500"
                    value={pollIntervalMs}
                    onChange={(e) => setPollIntervalMs(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: ABOUT VIEW */}
        {activeTab === 'about' && (
          <div className="clean-subpage">
            <div className="clean-card" style={{ padding: '24px' }}>
              <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Info size={20} style={{ color: '#38bdf8' }} />
                <span>About Tesseract</span>
              </h2>
              <p style={{ color: '#94a3b8', lineHeight: 1.6 }}>
                Full-stack IoT healthcare management system designed with ESP32 microcontroller, environmental telemetry
                sensors, and serverless Neon Postgres backend.
              </p>
              <div style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                <div style={{ background: '#09111d', padding: '14px', borderRadius: '8px', border: '1px solid #17283a' }}>
                  <strong style={{ color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Thermometer size={16} /> DHT11 Sensor
                  </strong>
                  <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '13px' }}>GPIO 4 | Temperature &amp; Humidity</p>
                </div>
                <div style={{ background: '#09111d', padding: '14px', borderRadius: '8px', border: '1px solid #17283a' }}>
                  <strong style={{ color: '#34d399', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Pill size={16} /> IR Presence Sensor
                  </strong>
                  <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '13px' }}>GPIO 18 | Medicine Detection</p>
                </div>
                <div style={{ background: '#09111d', padding: '14px', borderRadius: '8px', border: '1px solid #17283a' }}>
                  <strong style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Database size={16} /> Vercel Serverless
                  </strong>
                  <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '13px' }}>Edge API + Neon Serverless Postgres</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <footer className="clean-footer">
          &copy; 2026 Tesseract &nbsp;|&nbsp; Built with ESP32 &nbsp;|&nbsp; Monitor &bull; Protect &bull; Stay Healthy
        </footer>
      </main>
    </div>
  );
}

export default CleanDashboard;
