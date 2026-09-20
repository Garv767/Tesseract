import React from 'react';
import { useSimulation } from '../../context/SimulationContext';
import {
  Cpu,
  Wifi,
  WifiOff,
  Clock,
  Play,
  Pause,
  RotateCcw,
  GraduationCap,
  Sparkles,
  Activity,
  Box,
  Layers,
  Code2,
  Database,
  BarChart3,
  Settings as SettingsIcon,
  Bell,
  HeartPulse,
  Thermometer
} from 'lucide-react';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab }) => {
  const {
    state,
    startSimulation,
    pauseSimulation,
    resetSimulation,
    runCompleteDemo,
    toggleVivaMode
  } = useSimulation();

  const navItems = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'digital-twin', label: 'Digital Twin', icon: Box },
    { id: 'live-simulation', label: 'Live Simulation', icon: Play },
    { id: 'hardware-signals', label: 'Hardware & Signals', icon: Layers },
    { id: 'medication', label: 'Medication Adherence', icon: HeartPulse },
    { id: 'environmental', label: 'Environmental', icon: Thermometer },
    { id: 'caregiver', label: 'Caregiver View', icon: Bell },
    { id: 'embedded-c', label: 'Embedded C IDE', icon: Code2 },
    { id: 'architecture', label: 'Architecture & Flow', icon: Cpu },
    { id: 'database', label: 'DB & API Inspector', icon: Database },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: SettingsIcon }
  ];

  return (
    <header className="bg-[#0f172a] border-b border-[#1e293b] sticky top-0 z-50 shadow-xl">
      {/* Top Utility Bar */}
      <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center justify-between text-xs border-b border-[#1e293b]/60 gap-2">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 font-bold text-cyan-400">
            <Cpu className="w-4 h-4 animate-pulse" />
            <span>ESP32 Tesseract</span>
            <span className="bg-cyan-950 text-cyan-400 border border-cyan-800 px-1.5 py-0.5 rounded text-[10px] uppercase font-mono">
              DIGITAL TWIN SIMULATION
            </span>
          </div>

          <div className="hidden sm:flex items-center space-x-2 text-slate-400">
            <span className="text-slate-600">|</span>
            <span>Device: <strong className="text-slate-200">{state.deviceId}</strong></span>
            <span className="text-slate-600">|</span>
            <span className="flex items-center space-x-1">
              {state.wifiConnected ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Wi-Fi Connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                  <span className="text-rose-400">Wi-Fi Disconnected</span>
                </>
              )}
            </span>
          </div>
        </div>

        {/* System Simulation Indicators & Demo Triggers */}
        <div className="flex items-center space-x-2.5">
          {/* Clock */}
          <div className="flex items-center space-x-1 bg-[#1e293b] text-slate-200 px-2.5 py-1 rounded font-mono">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>{state.currentSimulationTime.toLocaleTimeString()}</span>
          </div>

          {/* Quick Simulation Running Badge */}
          <button
            onClick={state.simulationRunning ? pauseSimulation : startSimulation}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded font-semibold transition-all ${
              state.simulationRunning
                ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-700/50 hover:bg-emerald-900'
                : 'bg-amber-950/80 text-amber-400 border border-amber-700/50 hover:bg-amber-900'
            }`}
          >
            {state.simulationRunning ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                <span>RUNNING ({state.simulationSpeed}x)</span>
              </>
            ) : (
              <>
                <Pause className="w-3 h-3 text-amber-400" />
                <span>PAUSED</span>
              </>
            )}
          </button>

          {/* Complete 26-step Demo Trigger */}
          <button
            onClick={runCompleteDemo}
            className="flex items-center space-x-1.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-semibold px-3 py-1 rounded shadow-md transition-all transform active:scale-95 text-xs"
          >
            <Sparkles className="w-3.5 h-3.5 animate-spin" />
            <span>RUN COMPLETE DEMO</span>
          </button>

          {/* Viva Mode Toggle */}
          <button
            onClick={toggleVivaMode}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded font-medium border transition-all ${
              state.isVivaMode
                ? 'bg-purple-900/60 text-purple-300 border-purple-500 shadow-purple-900/30'
                : 'bg-[#1e293b] text-slate-400 border-[#334155] hover:text-slate-200'
            }`}
            title="Enable Viva Architectural Overlay"
          >
            <GraduationCap className="w-3.5 h-3.5" />
            <span>VIVA MODE</span>
          </button>

          {/* Reset Button */}
          <button
            onClick={resetSimulation}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-[#1e293b] rounded transition-all"
            title="Reset Simulation State"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Tab Navigation Bar */}
      <div className="max-w-7xl mx-auto px-4 overflow-x-auto scrollbar-none">
        <nav className="flex space-x-1 py-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center space-x-1.5 px-3 py-2 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-cyan-600/30 to-blue-600/30 text-cyan-300 border border-cyan-500/40 shadow-inner'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#1e293b]/60'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
