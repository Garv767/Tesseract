import React from 'react';
import { Cpu, ShieldAlert, CheckCircle2, Server, Globe } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-[#0b0f19] border-t border-[#1e293b] py-6 px-4 text-xs text-slate-400">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <div className="flex items-center space-x-2 text-cyan-400 font-bold mb-2">
            <Cpu className="w-4 h-4" />
            <span>Tesseract Digital Twin</span>
          </div>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            Software Digital Twin simulation demonstrating an IoT intelligent medicine enclosure featuring real-time telemetry, signal pulse flow, edge computing medication adherence state machine, environmental stability monitoring, and reference Embedded C firmware implementation.
          </p>
        </div>

        <div>
          <h4 className="text-slate-200 font-semibold mb-2 flex items-center space-x-1.5">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <span>Technical Honesty & Architecture</span>
          </h4>
          <ul className="space-y-1 text-[11px] text-slate-400">
            <li className="flex items-center space-x-1.5">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>Label: <strong>DIGITAL TWIN SIMULATION / REFERENCE FIRMWARE</strong></span>
            </li>
            <li className="flex items-center space-x-1.5">
              <Server className="w-3 h-3 text-cyan-400" />
              <span>Target Architecture: <strong>ESP32 Edge → Local Storage → Web Server → Dashboard</strong></span>
            </li>
            <li className="flex items-center space-x-1.5">
              <Globe className="w-3 h-3 text-purple-400" />
              <span>Cloud Dependency: <strong>NO AWS / External Backend Required (100% Client Emulated)</strong></span>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="text-slate-200 font-semibold mb-2">College Viva & Engineering Demonstration</h4>
          <p className="text-slate-400 text-[11px] leading-relaxed mb-2">
            This digital twin visualizes physical interactions (door opening, weight sensors, load cell ADC, reed switches) transmitting hardware signals to ESP32 pin mappings (GPIO 18, GPIO 4, GPIO 34, I2C), triggering FreeRTOS task logic and caregiver notifications.
          </p>
          <div className="text-[10px] text-slate-500 font-mono">
            Project Ref: ESP32-MED-STORAGE-v2.4 | viva-mode-ready
          </div>
        </div>
      </div>
    </footer>
  );
};
