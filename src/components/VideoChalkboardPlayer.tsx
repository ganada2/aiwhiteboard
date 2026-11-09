import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { VideoApiPayload } from '../shared/schema';
import { MathText } from './MathText';

interface VideoChalkboardPlayerProps {
  videoPayload: VideoApiPayload;
  onClose?: () => void;
}

interface ActiveWriteItem {
  id: string;
  text: string;
  x: number;
  y: number;
  underlined: boolean;
  circled: boolean;
  highlighted: boolean;
}

interface ActiveArrow {
  from: string;
  to: string;
}

export const VideoChalkboardPlayer: React.FC<VideoChalkboardPlayerProps> = ({
  videoPayload,
}) => {
  const { video, meta } = videoPayload;
  const scenes = video.scenes;

  const [sceneIndex, setSceneIndex] = useState(0);
  const [elapsedInScene, setElapsedInScene] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [showCheckAnswer, setShowCheckAnswer] = useState(false);

  const currentScene = scenes[sceneIndex] ?? scenes[0];
  const lastSpokenSceneRef = useRef<number>(-1);

  // 한국어 TTS 음성 출력
  useEffect(() => {
    if (!ttsEnabled || !isPlaying || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    if (lastSpokenSceneRef.current === sceneIndex && elapsedInScene > 0.3) {
      return;
    }

    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(currentScene.narration);
    utter.lang = 'ko-KR';
    utter.rate = Math.min(1.5, (video.mode === 'kid' ? 0.95 : 1.05) * playbackRate);
    utter.pitch = video.mode === 'kid' ? 1.15 : 1.0;
    window.speechSynthesis.speak(utter);
    lastSpokenSceneRef.current = sceneIndex;

    return () => {
      window.speechSynthesis.cancel();
    };
  }, [sceneIndex, isPlaying, ttsEnabled, currentScene.narration, video.mode, playbackRate, elapsedInScene]);

  // 타이머 루프 (0.1초 간격)
  useEffect(() => {
    if (!isPlaying) return;

    const intervalMs = 100;
    const timer = window.setInterval(() => {
      setElapsedInScene((prev) => {
        const next = prev + (intervalMs / 1000) * playbackRate;
        if (next >= currentScene.seconds) {
          if (sceneIndex < scenes.length - 1) {
            setSceneIndex((idx) => idx + 1);
            return 0;
          } else {
            setIsPlaying(false);
            return currentScene.seconds;
          }
        }
        return next;
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [isPlaying, playbackRate, currentScene.seconds, sceneIndex, scenes.length]);

  // 현재 장면의 elapsedInScene 시점까지 실행된 board_actions 상태 계산
  const boardState = useMemo(() => {
    const items = new Map<string, ActiveWriteItem>();
    const arrows: ActiveArrow[] = [];

    const sortedActions = [...currentScene.board_actions].sort((a, b) => a.at - b.at);

    for (const action of sortedActions) {
      if (action.at > elapsedInScene + 0.05) break;

      switch (action.type) {
        case 'write': {
          items.set(action.id, {
            id: action.id,
            text: action.text,
            x: Math.min(0.88, Math.max(0.12, action.x)),
            y: Math.min(0.86, Math.max(0.14, action.y)),
            underlined: false,
            circled: false,
            highlighted: false,
          });
          break;
        }
        case 'underline': {
          const item = items.get(action.target);
          if (item) item.underlined = true;
          break;
        }
        case 'circle': {
          const item = items.get(action.target);
          if (item) item.circled = true;
          break;
        }
        case 'highlight': {
          const item = items.get(action.target);
          if (item) item.highlighted = true;
          break;
        }
        case 'arrow': {
          if (items.has(action.from) && items.has(action.to)) {
            arrows.push({ from: action.from, to: action.to });
          }
          break;
        }
        case 'erase': {
          if (action.target === 'all') {
            items.clear();
            arrows.length = 0;
          } else {
            items.delete(action.target);
          }
          break;
        }
      }
    }

    return {
      writeItems: Array.from(items.values()),
      arrows,
    };
  }, [currentScene.board_actions, elapsedInScene]);

  // 전체 누적 진행률 계산
  const elapsedBeforeCurrentScene = useMemo(
    () => scenes.slice(0, sceneIndex).reduce((acc, s) => acc + s.seconds, 0),
    [scenes, sceneIndex],
  );
  const totalElapsed = Math.min(
    video.total_seconds,
    elapsedBeforeCurrentScene + elapsedInScene,
  );
  const totalProgressPercent =
    video.total_seconds > 0 ? (totalElapsed / video.total_seconds) * 100 : 0;

  const handleRestart = () => {
    lastSpokenSceneRef.current = -1;
    setSceneIndex(0);
    setElapsedInScene(0);
    setIsPlaying(true);
  };

  const handleSelectScene = (idx: number) => {
    lastSpokenSceneRef.current = -1;
    setSceneIndex(idx);
    setElapsedInScene(0);
    setIsPlaying(true);
  };

  return (
    <div className="rounded-2xl border-2 border-emerald-500/40 bg-slate-900/95 shadow-2xl overflow-hidden">
      {/* 상단 영상 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-emerald-950/70 border-b border-emerald-500/30">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
            <Sparkles className="w-3.5 h-3.5" />
            TASK=VIDEO 실시간 판서 플레이어
          </span>
          <h3 className="text-sm sm:text-base font-bold text-white truncate">
            {video.title}
          </h3>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {meta.consistencyChecked && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              <CheckCircle2 className="w-3.5 h-3.5" />
              SOLVE 수식 일치 검증됨
            </span>
          )}
          <span className="text-slate-400">
            장면 {sceneIndex + 1}/{scenes.length} · 총 {video.total_seconds}초
          </span>
        </div>
      </div>

      {/* 메인 칠판 애니메이션 캔버스 */}
      <div className="relative h-72 sm:h-88 w-full bg-gradient-to-br from-[#0f2e22] via-[#123528] to-[#0a2118] border-b-8 border-[#6b4423] overflow-hidden select-none">
        {/* 칠판 분필 질감 배경 효과 */}
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(rgba(255,255,255,0.22) 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        />

        {/* 좌상단 장면 Step 배지 */}
        <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-md bg-black/45 text-emerald-200 text-xs font-semibold border border-emerald-400/30">
            Scene #{currentScene.scene} (Step {currentScene.step_ref} 연동)
          </span>
        </div>

        {/* SVG 화살표(arrow) 레이어 */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
          <defs>
            <marker
              id="chalk-arrowhead"
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 Z" fill="#fde047" />
            </marker>
          </defs>
          {boardState.arrows.map((ar, idx) => {
            const fromItem = boardState.writeItems.find((w) => w.id === ar.from);
            const toItem = boardState.writeItems.find((w) => w.id === ar.to);
            if (!fromItem || !toItem) return null;
            return (
              <line
                key={`arrow_${idx}`}
                x1={`${fromItem.x * 100}%`}
                y1={`${(fromItem.y + 0.04) * 100}%`}
                x2={`${toItem.x * 100}%`}
                y2={`${(toItem.y - 0.05) * 100}%`}
                stroke="#fde047"
                strokeWidth="2.5"
                strokeDasharray="5,4"
                markerEnd="url(#chalk-arrowhead)"
              />
            );
          })}
        </svg>

        {/* 칠판 판서 요소(write, underline, circle, highlight) */}
        {boardState.writeItems.map((item) => {
          const isHeader = item.id.includes('header') || item.id.includes('title');
          return (
            <div
              key={item.id}
              style={{
                left: `${item.x * 100}%`,
                top: `${item.y * 100}%`,
                transform: 'translate(-50%, -50%)',
              }}
              className="absolute z-20 max-w-[88%] text-center transition-all duration-300 animate-fadeIn"
            >
              <div
                className={[
                  'inline-block px-3 py-1.5 rounded-lg transition-all duration-300',
                  isHeader
                    ? 'text-emerald-200 font-bold text-base sm:text-lg tracking-wide'
                    : 'text-white font-semibold text-lg sm:text-xl',
                  item.highlighted
                    ? 'bg-amber-300/25 text-amber-100 shadow-[0_0_16px_rgba(251,191,36,0.3)]'
                    : '',
                  item.underlined
                    ? ' underline decoration-amber-300 decoration-wavy decoration-2 underline-offset-8'
                    : '',
                  item.circled
                    ? 'ring-2 ring-rose-400 rounded-full px-5 py-2 bg-rose-500/15'
                    : '',
                ].join(' ')}
              >
                <MathText text={item.text} />
              </div>
            </div>
          );
        })}

        {/* 하단 실시간 자막 (선생님 나레이션) */}
        <div className="absolute bottom-3 inset-x-3 z-30">
          <div className="rounded-xl bg-black/75 backdrop-blur-md px-4 py-2.5 border border-white/15 shadow-lg">
            <p className="text-xs sm:text-sm text-amber-100 leading-relaxed font-medium text-center">
              🗣️ &ldquo;{currentScene.narration}&rdquo;
            </p>
          </div>
        </div>
      </div>

      {/* 장면 타임라인 탭 */}
      <div className="px-4 pt-3 pb-2 bg-slate-900 border-b border-slate-800">
        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mb-2.5">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-amber-400 transition-all duration-150"
            style={{ width: `${totalProgressPercent}%` }}
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {scenes.map((sc, idx) => {
            const active = idx === sceneIndex;
            return (
              <button
                key={sc.scene}
                type="button"
                onClick={() => handleSelectScene(idx)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 transition ${
                  active
                    ? 'bg-emerald-500 text-slate-950 font-bold shadow'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                #{sc.scene} ({sc.seconds}s)
              </button>
            );
          })}
        </div>
      </div>

      {/* 컨트롤 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-950/90">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              handleSelectScene(Math.max(0, sceneIndex - 1))
            }
            disabled={sceneIndex === 0}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
            title="이전 장면"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs sm:text-sm"
          >
            {isPlaying ? (
              <>
                <Pause className="w-4 h-4" /> 일시정지
              </>
            ) : (
              <>
                <Play className="w-4 h-4" /> 재생
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() =>
              handleSelectScene(Math.min(scenes.length - 1, sceneIndex + 1))
            }
            disabled={sceneIndex === scenes.length - 1}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
            title="다음 장면"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleRestart}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
            title="처음부터 다시 보기"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* 배속 선택 */}
          <div className="flex items-center rounded-lg bg-slate-800 p-0.5 text-xs">
            {[0.8, 1, 1.25, 1.5].map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => setPlaybackRate(rate)}
                className={`px-2 py-1 rounded-md font-medium ${
                  playbackRate === rate
                    ? 'bg-emerald-500 text-slate-950 font-bold'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>

          {/* 음성 나레이션 토글 */}
          <button
            type="button"
            onClick={() => {
              if (ttsEnabled && typeof window !== 'undefined' && 'speechSynthesis' in window) {
                window.speechSynthesis.cancel();
              }
              setTtsEnabled((v) => !v);
            }}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border ${
              ttsEnabled
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
          >
            {ttsEnabled ? (
              <>
                <Volume2 className="w-3.5 h-3.5" /> 음성 ON
              </>
            ) : (
              <>
                <VolumeX className="w-3.5 h-3.5" /> 음성 OFF
              </>
            )}
          </button>
        </div>
      </div>

      {/* 영상 마무리 요약(closing) & 확인문제 */}
      <div className="px-4 py-3 bg-slate-900/80 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs sm:text-sm text-slate-200">
          <span className="font-bold text-emerald-400 mr-2">📌 영상 핵심 요약:</span>
          <MathText text={video.closing.summary} />
        </div>

        {video.closing.check_question && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-amber-300 font-semibold">
              Q. {video.closing.check_question.q}
            </span>
            <button
              type="button"
              onClick={() => setShowCheckAnswer((s) => !s)}
              className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/30 font-semibold shrink-0"
            >
              {showCheckAnswer
                ? `정답: ${video.closing.check_question.a}`
                : '정답 확인'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
