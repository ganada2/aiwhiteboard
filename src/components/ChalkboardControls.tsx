import React from 'react';
import type { LearnMode } from '../shared/schema';

/**
 * 상단 3단계 슬라이딩 토글 스위치 (유아 ↔ 고등 ↔ 성인)
 */
export const ModeThreeStageToggle: React.FC<{
  mode: LearnMode;
  onChange: (m: LearnMode) => void;
}> = ({ mode, onChange }) => {
  const stages: Array<{ id: LearnMode; label: string; emoji: string }> = [
    { id: 'kid', label: '유아', emoji: '🐣' },
    { id: 'high', label: '고등', emoji: '🎓' },
    { id: 'adult', label: '성인', emoji: '💼' },
  ];

  const activeIdx = stages.findIndex((s) => s.id === mode);

  return (
    <div
      className="relative inline-grid grid-cols-3 items-center p-1 rounded-full bg-[#111715]/95 border border-white/15 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85),0_4px_12px_rgba(0,0,0,0.4)] select-none"
      style={{ width: '176px', height: '38px' }}
    >
      {/* 슬라이딩 3D 캡슐 썸(Thumb) */}
      <div
        style={{
          width: 'calc((100% - 8px) / 3)',
          transform: `translateX(${activeIdx * 100}%)`,
        }}
        className="absolute top-1 bottom-1 left-1 rounded-full bg-gradient-to-b from-emerald-300 via-emerald-400 to-teal-500 shadow-[0_2px_10px_rgba(16,185,129,0.55),inset_0_1px_1px_rgba(255,255,255,0.7)] transition-transform duration-250 ease-out pointer-events-none"
      />

      {stages.map((st) => {
        const active = st.id === mode;
        return (
          <button
            key={st.id}
            type="button"
            onClick={() => onChange(st.id)}
            className={`relative z-10 flex items-center justify-center gap-0.5 h-full rounded-full text-[11px] font-black tracking-tight transition-colors cursor-pointer ${
              active ? 'text-slate-950' : 'text-slate-300 hover:text-white'
            }`}
          >
            <span className="text-xs leading-none">{st.emoji}</span>
            <span>{st.label}</span>
          </button>
        );
      })}
    </div>
  );
};

/**
 * 실제 분필 스틱 모양의 3D 입체 버튼
 */
export const ChalkStickButton: React.FC<{
  color: string;
  name: string;
  active: boolean;
  onClick: () => void;
}> = ({ color, name, active, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${name} 선택`}
      className={`group relative flex flex-col items-center justify-end w-8 sm:w-9 h-12 sm:h-13 pt-1 transition-all duration-200 cursor-pointer ${
        active
          ? '-translate-y-2 scale-110 drop-shadow-[0_6px_10px_rgba(0,0,0,0.75)]'
          : 'translate-y-0.5 opacity-80 hover:opacity-100 hover:-translate-y-1'
      }`}
    >
      {/* 분필 본체 SVG */}
      <svg viewBox="0 0 36 56" className="w-full h-full overflow-visible">
        <defs>
          <linearGradient id={`chalkGrad_${color}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
            <stop offset="45%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.28" />
          </linearGradient>
        </defs>
        {/* 분필 둥근 촉 */}
        <path
          d="M10 14 C10 6, 26 6, 26 14 L27 48 L9 48 Z"
          fill={color}
        />
        <path
          d="M10 14 C10 6, 26 6, 26 14 L27 48 L9 48 Z"
          fill={`url(#chalkGrad_${color})`}
        />
        {/* 분필 종이 띠 슬리브 */}
        <rect
          x="8.5"
          y="30"
          width="19"
          height="18"
          rx="2"
          fill="#1e293b"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="1"
        />
        <rect x="8.5" y="33" width="19" height="3" fill={color} opacity="0.85" />
      </svg>
      {active && (
        <span
          style={{ backgroundColor: color }}
          className="absolute -bottom-1 w-4 h-1 rounded-full shadow-[0_0_8px_currentColor]"
        />
      )}
    </button>
  );
};

/**
 * 실제 교실 나무 칠판지우개 모양의 3D 입체 버튼
 */
export const FeltEraserButton: React.FC<{
  active: boolean;
  onClick: () => void;
}> = ({ active, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title="분필 지우개"
      className={`relative flex flex-col items-center justify-end w-10 sm:w-11 h-12 sm:h-13 transition-all duration-200 cursor-pointer ${
        active
          ? '-translate-y-2 scale-110 drop-shadow-[0_8px_12px_rgba(244,63,94,0.45)]'
          : 'translate-y-0.5 opacity-85 hover:opacity-100 hover:-translate-y-1'
      }`}
    >
      <svg viewBox="0 0 46 52" className="w-full h-full">
        {/* 상단 폭신한 분필 펠트(초록/회백색 층) */}
        <rect
          x="6"
          y="10"
          width="34"
          height="12"
          rx="3"
          fill="#cbd5e1"
          stroke="#94a3b8"
          strokeWidth="1"
        />
        <rect x="6" y="18" width="34" height="6" fill="#0f5132" />
        {/* 나무 손잡이 본체 */}
        <rect
          x="4"
          y="24"
          width="38"
          height="20"
          rx="4"
          fill="#b45309"
          stroke="#f59e0b"
          strokeWidth="1.2"
        />
        {/* 나무 손잡이 홈 디테일 */}
        <rect x="9" y="30" width="28" height="3" rx="1.5" fill="#78350f" />
        <text
          x="23"
          y="41"
          textAnchor="middle"
          fill="#fef3c7"
          fontSize="7.5"
          fontWeight="900"
        >
          지우개
        </text>
      </svg>
      {active && (
        <span className="absolute -bottom-1 w-5 h-1 rounded-full bg-rose-400 shadow-[0_0_8px_#fb7185]" />
      )}
    </button>
  );
};

/**
 * 입체 형광 분필 마커 버튼
 */
export const HighlighterMarkerButton: React.FC<{
  active: boolean;
  onClick: () => void;
}> = ({ active, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title="형광펜 강조"
      className={`relative flex flex-col items-center justify-end w-9 sm:w-10 h-12 sm:h-13 transition-all duration-200 cursor-pointer ${
        active
          ? '-translate-y-2 scale-110 drop-shadow-[0_8px_12px_rgba(250,204,21,0.45)]'
          : 'translate-y-0.5 opacity-85 hover:opacity-100 hover:-translate-y-1'
      }`}
    >
      <svg viewBox="0 0 40 54" className="w-full h-full">
        {/* 사선 형광펜 팁 */}
        <polygon points="14,14 26,8 26,20 14,20" fill="#fde047" />
        {/* 펜 목 */}
        <rect x="12" y="20" width="16" height="6" rx="1.5" fill="#334155" />
        {/* 형광 바디 */}
        <rect
          x="9"
          y="25"
          width="22"
          height="23"
          rx="4"
          fill="#facc15"
          stroke="#fef08a"
          strokeWidth="1.2"
        />
        <text
          x="20"
          y="40"
          textAnchor="middle"
          fill="#1e293b"
          fontSize="7.5"
          fontWeight="900"
        >
          형광
        </text>
      </svg>
      {active && (
        <span className="absolute -bottom-1 w-5 h-1 rounded-full bg-amber-300 shadow-[0_0_8px_#fde047]" />
      )}
    </button>
  );
};

/**
 * 입체 포스트잇 메모장 추가 버튼
 */
export const MemoPadButton: React.FC<{
  onClick: () => void;
}> = ({ onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title="칠판에 텍스트·수식 메모 카드 붙이기"
      className="group relative flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-gradient-to-b from-amber-200 via-amber-300 to-amber-400 text-slate-950 font-black text-xs shadow-[0_4px_12px_rgba(251,191,36,0.35),inset_0_1px_1px_rgba(255,255,255,0.85)] border border-amber-200/80 active:translate-y-0.5 transition cursor-pointer shrink-0"
    >
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0">
        <path
          d="M4 4h16v12l-4 4H4V4z"
          fill="#fef08a"
          stroke="#78350f"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M16 20v-4h4"
          fill="none"
          stroke="#78350f"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M12 8v6M9 11h6"
          stroke="#78350f"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
      <span>+메모</span>
    </button>
  );
};

/**
 * 입체 도형·화살표 스텐실 버튼
 */
export const ShapeStencilButton: React.FC<{
  active: boolean;
  onClick: () => void;
}> = ({ active, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title="점선 네모 · 동그라미 · 점선 화살표 도구"
      className={`relative flex flex-col items-center justify-end w-10 h-12 sm:h-13 transition-all duration-200 cursor-pointer ${
        active
          ? '-translate-y-2 scale-110 drop-shadow-[0_6px_12px_rgba(56,189,248,0.45)]'
          : 'translate-y-0.5 opacity-85 hover:opacity-100 hover:-translate-y-1'
      }`}
    >
      <svg viewBox="0 0 44 52" className="w-full h-full">
        {/* 삼각자 스텐실 모양 */}
        <polygon
          points="6,46 38,46 6,12"
          fill="rgba(56,189,248,0.22)"
          stroke="#7dd3fc"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <polygon
          points="12,40 24,40 12,27"
          fill="none"
          stroke="#bae6fd"
          strokeWidth="1.4"
          strokeDasharray="3,2"
        />
      </svg>
      {active && (
        <span className="absolute -bottom-1 w-5 h-1 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8]" />
      )}
    </button>
  );
};
