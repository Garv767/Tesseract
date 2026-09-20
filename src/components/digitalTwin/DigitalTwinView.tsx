import React from 'react';
import { MedicineBoxSchematic } from './MedicineBoxSchematic';
import { DigitalTwinTimeline } from './DigitalTwinTimeline';
import { ComponentDetailsModal } from './ComponentDetailsModal';
import { VivaTracePanel } from '../viva/VivaTracePanel';
import { useSimulation } from '../../context/SimulationContext';
import { Cpu, DoorOpen, DoorClosed, Pill, Flame, AlertTriangle, ShieldCheck, Database, Info } from 'lucide-react';

export const DigitalTwinView: React.FC = () => {
  const {
    state,
    openDoor,
    closeDoor,
    removeMedicine,
    restoreMedicine,
    raiseTemperature,
    simulateMissedDose
  } = useSimulation();

  return (
    <div className="space-y-6">
      {/* Top Banner Notice */}
      <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
            <Cpu className="w-5 h-5 text-cyan-400" />
            <span>ESP32 Tesseract DIGITAL TWIN</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Centralized hardware & software behavioral simulation synchronized with ESP32 edge processing logic.
          </p>
        </div>

        {/* Quick Interaction Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={state.doorOpen ? closeDoor : openDoor}
            className="flex items-center space-x-1.5 bg-[#182542] hover:bg-[#25355c] text-cyan-300 border border-cyan-800 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          >
            {state.doorOpen ? <DoorClosed className="w-3.5 h-3.5" /> : <DoorOpen className="w-3.5 h-3.5" />}
            <span>{state.doorOpen ? 'CLOSE DOOR' : 'OPEN DOOR'}</span>
          </button>

          <button
            onClick={() => (state.medicinePresent ? removeMedicine('A1') : restoreMedicine('A1'))}
            className="flex items-center space-x-1.5 bg-[#182542] hover:bg-[#25355c] text-emerald-300 border border-emerald-800 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          >
            <Pill className="w-3.5 h-3.5" />
            <span>{state.medicinePresent ? 'REMOVE MEDICINE A' : 'RESTORE MEDICINE A'}</span>
          </button>

          <button
            onClick={() => raiseTemperature(3.5)}
            className="flex items-center space-x-1.5 bg-[#182542] hover:bg-[#25355c] text-amber-300 border border-amber-800 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          >
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            <span>HEAT (+3.5°C)</span>
          </button>

          <button
            onClick={simulateMissedDose}
            className="flex items-center space-x-1.5 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            <span>SIMULATE MISSED DOSE</span>
          </button>
        </div>
      </div>

      {/* EXPLICIT DOSAGE LOGIC BANNER (Priority 6) */}
      <div className="bg-[#131b2e] border border-[#2b3e66] rounded-xl p-3.5 text-xs flex items-center justify-between text-slate-300">
        <div className="flex items-center space-x-2">
          <Info className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>
            <strong>DOSAGE LOGIC RULE:</strong> Door opening alone = <em>ACCESS EVENT ONLY</em>. Dosage is recorded as <strong>TAKEN</strong> only when: (1) Schedule window is active AND (2) Correct compartment container is removed AND (3) HX711 Load Cell detects weight drop (52.4g → 0.0g).
          </span>
        </div>
      </div>

      {/* VIVA MODE TRACE PIPELINE (If Viva Mode Active or Always Accessible) */}
      {state.isVivaMode && <VivaTracePanel />}

      {/* Hardware Inspector Modal if Component Highlighted */}
      <ComponentDetailsModal />

      {/* Main Digital Twin Schematic Section */}
      <MedicineBoxSchematic />

      {/* Telemetry Data Packet & Hardware Output Status Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* LIVE TELEMETRY DATA PACKET INSPECTOR */}
        <div className="bg-[#111a2e] border border-[#1e293b] rounded-xl p-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-[#1e293b] pb-2 mb-3">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-1.5">
              <Database className="w-4 h-4 text-cyan-400" />
              <span>LIVE TELEMETRY PACKET</span>
            </span>
            <span className="text-[10px] bg-cyan-950 text-cyan-400 px-2 py-0.5 rounded font-mono">
              JSON PAYLOAD
            </span>
          </div>

          <pre className="bg-[#090e1a] text-cyan-300 p-3 rounded-lg text-[11px] font-mono overflow-x-auto border border-[#17233d] leading-relaxed">
{JSON.stringify(
  {
    deviceId: state.deviceId,
    temperature: state.temperature,
    humidity: state.humidity,
    doorOpen: state.doorOpen,
    medicinePresent: state.medicinePresent,
    weight: state.weight,
    battery: state.battery,
    wifiConnected: state.wifiConnected,
    timestamp: state.currentSimulationTime.toLocaleTimeString()
  },
  null,
  2
)}
          </pre>
        </div>

        {/* ESP32 EDGE DECISION ENGINE STATUS */}
        <div className="bg-[#111a2e] border border-[#1e293b] rounded-xl p-4 shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-[#1e293b] pb-2 mb-3">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-1.5">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <span>ESP32 EDGE PROCESSING ENGINE</span>
            </span>
            <span className="text-[10px] bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded font-mono">
              ACTIVE
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="bg-[#18233b] p-2 rounded flex justify-between">
              <span className="text-slate-400">Current Task:</span>
              <strong className="text-amber-400 font-mono">{state.currentFirmwareFunction || 'loop()'}</strong>
            </div>
            <div className="bg-[#18233b] p-2 rounded flex justify-between">
              <span className="text-slate-400">Storage Health Score:</span>
              <strong className={state.storageHealth < 80 ? 'text-rose-400' : 'text-emerald-400'}>
                {state.storageHealth} / 100
              </strong>
            </div>
            <div className="bg-[#18233b] p-2 rounded flex justify-between">
              <span className="text-slate-400">Medication Compliance:</span>
              <strong className="text-cyan-400">{state.compliance}%</strong>
            </div>
            <div className="bg-[#18233b] p-2 rounded flex justify-between">
              <span className="text-slate-400">Buzzer / LED Actuators:</span>
              <span className="font-mono text-slate-200">
                LED: {state.hardwareOutputs.led} | Buzz: {state.hardwareOutputs.buzzer}
              </span>
            </div>
          </div>

          <div className="mt-3 text-[10px] text-slate-400 bg-slate-900/60 p-2 rounded border border-slate-800">
            <strong>Edge Logic Rule:</strong> Critical decision engine executes locally on ESP32 dual core without requiring cloud connectivity.
          </div>
        </div>

        {/* ACTIVE ALERTS SUMMARY */}
        <div className="bg-[#111a2e] border border-[#1e293b] rounded-xl p-4 shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-[#1e293b] pb-2 mb-3">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>ACTIVE SYSTEM ALERTS</span>
            </span>
            <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
              {state.alerts.filter((a) => a.status === 'ACTIVE').length} Active
            </span>
          </div>

          <div className="space-y-2 overflow-y-auto max-h-[140px] pr-1">
            {state.alerts.filter((a) => a.status === 'ACTIVE').length > 0 ? (
              state.alerts
                .filter((a) => a.status === 'ACTIVE')
                .slice(0, 3)
                .map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-2.5 rounded border text-xs ${
                      alert.severity === 'CRITICAL'
                        ? 'bg-rose-950/60 border-rose-800 text-rose-200'
                        : 'bg-amber-950/60 border-amber-800 text-amber-200'
                    }`}
                  >
                    <div className="font-bold flex items-center justify-between">
                      <span>{alert.title}</span>
                      <span className="text-[10px] opacity-75 font-mono">{alert.timestamp}</span>
                    </div>
                    <p className="text-[11px] mt-1 opacity-90">{alert.description}</p>
                  </div>
                ))
            ) : (
              <div className="p-4 text-center text-xs text-slate-500 bg-[#18233b] rounded border border-[#26375a]">
                <ShieldCheck className="w-6 h-6 text-emerald-400 mx-auto mb-1 opacity-70" />
                All storage parameters normal. No active alerts.
              </div>
            )}
          </div>

          <div className="mt-3 text-[10px] text-slate-400 text-right">
            Click <strong>Alerts</strong> tab to manage & acknowledge
          </div>
        </div>
      </div>

      {/* Bottom Pipeline Event Timeline */}
      <DigitalTwinTimeline />
    </div>
  );
};
