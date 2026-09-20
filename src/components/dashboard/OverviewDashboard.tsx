import React from 'react';
import { useSimulation } from '../../context/SimulationContext';
import {
  Thermometer,
  Droplets,
  DoorClosed,
  DoorOpen,
  Weight,
  Battery,
  HeartPulse,
  ShieldCheck,
  AlertTriangle,
  Activity
} from 'lucide-react';
import { TelemetryCharts } from '../telemetry/TelemetryCharts';

export const OverviewDashboard: React.FC = () => {
  const { state } = useSimulation();

  const evaluableDoses = state.doseHistory.filter(
    (d) => d.status === 'TAKEN' || d.status === 'MISSED' || d.status === 'DUE' || d.status === 'PENDING'
  );
  const takenCount = state.doseHistory.filter((d) => d.status === 'TAKEN').length;

  return (
    <div className="space-y-6">
      {/* Top Welcome & KPI Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#0f172a] border border-[#1e293b] rounded-xl p-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center space-x-2">
            <Activity className="w-5 h-5 text-cyan-400" />
            <span>Tesseract OVERVIEW</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time digital twin monitoring console for medication compliance and environmental conditions.
          </p>
        </div>

        <div className="flex items-center space-x-2 text-xs">
          <span className="bg-slate-800 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700 font-mono">
            Device: <strong>{state.deviceId}</strong>
          </span>
          <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 px-3 py-1.5 rounded-lg font-mono font-semibold">
            STATUS: NORMAL
          </span>
        </div>
      </div>

      {/* 9 MAIN KPI CARDS GRID */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {/* TEMPERATURE */}
        <div className="bg-[#111a2e] border border-[#1e293b] rounded-xl p-4 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
            <span>TEMPERATURE</span>
            <Thermometer className={`w-4 h-4 ${state.temperature > state.settings.tempMax ? 'text-rose-400' : 'text-cyan-400'}`} />
          </div>
          <div className="my-2">
            <div className="text-2xl font-bold text-slate-100 font-mono">
              {state.temperature}°C
            </div>
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${
                state.temperature > state.settings.tempMax
                  ? 'bg-rose-950 text-rose-400 border border-rose-800'
                  : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
              }`}
            >
              {state.temperature > state.settings.tempMax ? 'HIGH WARNING' : 'NORMAL (15-25°C)'}
            </span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono">Sensor: DHT22 (GPIO 4)</div>
        </div>

        {/* HUMIDITY */}
        <div className="bg-[#111a2e] border border-[#1e293b] rounded-xl p-4 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
            <span>HUMIDITY</span>
            <Droplets className="w-4 h-4 text-blue-400" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-bold text-slate-100 font-mono">
              {state.humidity}% RH
            </div>
            <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded font-mono font-bold">
              OPTIMAL (30-60%)
            </span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono">Sensor: DHT22 (GPIO 4)</div>
        </div>

        {/* DOOR STATE */}
        <div className="bg-[#111a2e] border border-[#1e293b] rounded-xl p-4 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
            <span>DOOR STATUS</span>
            {state.doorOpen ? (
              <DoorOpen className="w-4 h-4 text-amber-400 animate-bounce" />
            ) : (
              <DoorClosed className="w-4 h-4 text-emerald-400" />
            )}
          </div>
          <div className="my-2">
            <div className={`text-2xl font-bold font-mono ${state.doorOpen ? 'text-amber-400' : 'text-emerald-400'}`}>
              {state.doorOpen ? 'OPEN' : 'CLOSED'}
            </div>
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${
                state.doorOpen
                  ? 'bg-amber-950 text-amber-400 border border-amber-800'
                  : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
              }`}
            >
              {state.doorOpen ? 'REED SWITCH LOW' : 'REED SWITCH HIGH'}
            </span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono">Switch: GPIO 18</div>
        </div>

        {/* MEDICINE WEIGHT */}
        <div className="bg-[#111a2e] border border-[#1e293b] rounded-xl p-4 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
            <span>CHAMBER WEIGHT</span>
            <Weight className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-bold text-slate-100 font-mono">
              {state.weight.toFixed(1)}g
            </div>
            <span className="text-[10px] bg-slate-800 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded font-mono">
              LOAD CELL (ADC 34)
            </span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono">Sensor: HX711 Load Cell</div>
        </div>

        {/* MEDICATION COMPLIANCE */}
        <div className="bg-[#111a2e] border border-[#1e293b] rounded-xl p-4 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
            <span>MEDICATION COMPLIANCE</span>
            <HeartPulse className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-bold text-cyan-300 font-mono">
              {state.compliance}%
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1.5">
              <div
                className="bg-cyan-400 h-full transition-all duration-500"
                style={{ width: `${state.compliance}%` }}
              />
            </div>
          </div>
          <div className="text-[10px] text-slate-500 font-mono">Taken: {takenCount} / {evaluableDoses.length} Scheduled</div>
        </div>

        {/* STORAGE HEALTH SCORE */}
        <div className="bg-[#111a2e] border border-[#1e293b] rounded-xl p-4 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
            <span>STORAGE HEALTH</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="my-2">
            <div className={`text-2xl font-bold font-mono ${state.storageHealth < 80 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {state.storageHealth} / 100
            </div>
            <span className="text-[10px] text-slate-400 italic">Project-Defined Metric</span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono">Not Medical Certification</div>
        </div>

        {/* BATTERY LEVEL */}
        <div className="bg-[#111a2e] border border-[#1e293b] rounded-xl p-4 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
            <span>SYSTEM BATTERY</span>
            <Battery className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-bold text-slate-100 font-mono">
              {state.battery}%
            </div>
            <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded font-mono">
              CHARGING (VCC 5V)
            </span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono">Backup Li-Po Battery</div>
        </div>

        {/* ACTIVE ALERTS */}
        <div className="bg-[#111a2e] border border-[#1e293b] rounded-xl p-4 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
            <span>ACTIVE ALERTS</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-bold text-amber-400 font-mono">
              {state.alerts.filter((a) => a.status === 'ACTIVE').length}
            </div>
            <span className="text-[10px] bg-amber-950 text-amber-400 border border-amber-800 px-1.5 py-0.5 rounded font-mono">
              ATTENTION REQUIRED
            </span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono">Alert Engine Active</div>
        </div>
      </div>

      {/* TELEMETRY CHARTS SECTION */}
      <TelemetryCharts />
    </div>
  );
};
