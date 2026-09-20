import React from 'react';
import { useSimulation } from '../../context/SimulationContext';
import {
  Activity,
  Box,
  HeartPulse,
  BarChart3,
  Clock,
  Code2,
  Cpu
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const { state } = useSimulation();

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Activity },
    { id: 'digital-twin', label: 'Digital Twin', icon: Box },
    { id: 'medication', label: 'Medication', icon: HeartPulse },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'events', label: 'Events', icon: Clock },
    { id: 'code', label: 'Code', icon: Code2 }
  ];

  return (
    <aside className="w-56 bg-[#0f0f0f] border-r border-[#222222] flex flex-col justify-between h-screen sticky top-0 shrink-0 z-40 select-none">
      <div>
        {/* Logo & Header */}
        <div className="p-4 border-b border-[#222222]">
          <div className="flex items-center space-x-2 text-slate-100 font-bold text-xs tracking-wider font-mono">
            <Cpu className="w-4 h-4 text-slate-100 shrink-0" />
            <span className="truncate">TESSERACT</span>
          </div>
          <div className="text-[10px] text-slate-400 font-mono mt-0.5 tracking-wider uppercase">
            ESP32 DIGITAL TWIN
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="p-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-[#1e1e1e] text-emerald-400 border-l-2 border-emerald-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#151515]'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-slate-500'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Device & Status Badge */}
      <div className="p-4 border-t border-[#222222] bg-[#0a0a0a] text-[11px] font-sans text-slate-400 space-y-4">
        <div>
          <div className="text-slate-500 mb-0.5">Device</div>
          <div className="text-slate-200 font-mono tracking-wide">{state.deviceId}</div>
          <div className="flex items-center space-x-1.5 text-emerald-500 font-medium mt-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Online</span>
          </div>
        </div>

        <button className="w-full py-1.5 px-3 rounded border border-emerald-900/50 bg-[#121212] text-emerald-500 hover:bg-[#1a1a1a] transition-colors font-medium">
          Simulation Mode
        </button>

        <div className="text-[10px] text-slate-500 leading-tight">
          Smart Healthcare<br />
          for a Better Tomorrow
        </div>
      </div>
    </aside>
  );
};
