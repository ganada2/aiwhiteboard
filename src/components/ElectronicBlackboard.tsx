import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Code2,
  Eraser,
  FilePlus2,
  Grid,
  HelpCircle,
  Highlighter,
  Info,
  Loader2,
  Minus,
  MousePointer,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Send,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  LearnAction,
  LearnMode,
  SolveApiPayload,
  VideoApiPayload,
} from '../shared/schema';
import { shareChalkboardSummary, triggerAitHaptic } from '../utils/aitBridge';
import { MathText } from './MathText';

export type ChalkTool =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'text'
  | 'rect'
  | 'circle'
  | 'arrow';

export interface Point {
  x: number;
  y: number;
}

export interface ChalkStroke {
  id: string;
  tool: ChalkTool;
  color: string;
  width: number;
  points: Point[];
  text?: string;
}

export interface MemoBoardTab {
  id: string;
  title: string;
  mode: LearnMode;
  action: LearnAction;
  question: string;
}

interface ElectronicBlackboardProps {
  mode: LearnMode;
  action: LearnAction;
  questionInput: string;
  onChangeMode: (m: LearnMode) => void;
  onChangeAction: (a: LearnAction) => void;
  onChangeQuestionInput: (q: string) => void;
  onSubmitQuestion: (q?: string, overrideMode?: LearnMode, overrideAction?: LearnAction) => void;
  solvePayload: SolveApiPayload | null;
  videoPayload: VideoApiPayload | null;
  isSolving: boolean;
  isGeneratingVideo: boolean;
  onRequestVideo: () => void;
  onOpenInspector: () => void;
  errorMsg: string | null;
}

const CHALK_COLORS = [
  { name: '백묵(흰색)', value: '#F8FAFC' },
  { name: '노란 분필', value: '#FDE047' },
  { name: '형광 연두', value: '#6EE7B7' },
  { name: '분홍 분필', value: '#FDA4AF' },
  { name: '하늘 분필', value: '#7DD3FC' },
];

const QUICK_PROBLEMS: Record<LearnMode, Array<{ label: string; q: string; action: LearnAction }>> = {
  kid: [
    { label: '🍎 1+1=?', q: '1+1=?', action: 'solve' },
    { label: '🍬 3+5=?', q: '3 + 5 = ?', action: 'solve' },
    { label: '📐 삼각형 비밀', q: '피타고라스 정리', action: 'explain' },
    { label: '❓ 되묻기(clarify)', q: '이거 풀어줘', action: 'solve' },
  ],
  high: [
    { label: 'x²-5x+6=0', q: 'x^2 - 5x + 6 = 0', action: 'solve' },
    { label: '피타고라스 정리', q: '피타고라스 정리', action: 'explain' },
    { label: '(12+8)*3-6', q: '(12 + 8) * 3 - 6 = ?', action: 'solve' },
    { label: '❓ clarify', q: 'x값 구해줘', action: 'solve' },
    { label: '🚫 unsupported', q: '로또번호 추천해줘', action: 'solve' },
  ],
  adult: [
    { label: '💰 복리와 72법칙', q: '복리 계산과 72의 법칙', action: 'explain' },
    { label: '📊 x²-5x+6=0', q: 'x^2 - 5x + 6 = 0', action: 'solve' },
    { label: '🔒 개인정보 마스킹', q: '내 이름은 김철수야 010-1234-5678 1+1=?', action: 'solve' },
  ],
};

export const ElectronicBlackboard: React.FC<ElectronicBlackboardProps> = ({
  mode,
  action,
  questionInput,
  onChangeMode,
  onChangeAction,
  onChangeQuestionInput,
  onSubmitQuestion,
  solvePayload,
  videoPayload,
  isSolving,
  isGeneratingVideo,
  onRequestVideo,
  onOpenInspector,
  errorMsg,
}) => {
  // 현재 시각 표시 (좌측 상단 전자칠판 시계)
  const [nowTime, setNowTime] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNowTime(new Date()), 30000);
    return () => window.clearInterval(t);
  }, []);

  // 판서 도구 상태
  const [activeTool, setActiveTool] = useState<ChalkTool>('pen');
  const [chalkColor, setChalkColor] = useState<string>('#F8FAFC');
  const [strokeWidth, setStrokeWidth] = useState<number>(3.5);
  const [showGrid, setShowGrid] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(100);
  const [sharedToast, setSharedToast] = useState<boolean>(false);

  // 슬라이드 페이지 구성:
  // #0: 전체 판서 한눈에 보기 (종합 칠판)
  // #1 ~ #N: 각 Step별 집중 판서 슬라이드
  // #N+1: 오답노트 & 확인문제 칠판
  // 추가 사용자 빈 메모 칠판 페이지들
  const [customBlankPages, setCustomBlankPages] = useState<number[]>([1]);
  const [currentPageIdx, setCurrentPageIdx] = useState<number>(0);

  // 페이지별 사용자 판서 스트로크 저장소: key = pageId
  const [strokesByPage, setStrokesByPage] = useState<Record<string, ChalkStroke[]>>({});
  const [currentStroke, setCurrentStroke] = useState<ChalkStroke | null>(null);

  // 텍스트 메모 입력 오버레이 상태
  const [pendingTextPos, setPendingTextPos] = useState<Point | null>(null);
  const [pendingTextValue, setPendingTextValue] = useState<string>('');

  // 확인문제 정답 토글 및 입력
  const [checkAnswerInput, setCheckAnswerInput] = useState<string>('');
  const [showCheckAnswer, setShowCheckAnswer] = useState<boolean>(false);

  // 탭(#1, #2...) 상태
  const [boardTabs, setBoardTabs] = useState<MemoBoardTab[]>([
    { id: 'tab-1', title: 'Tab #1', mode: 'kid', action: 'solve', question: '1+1=?' },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');

  // VIDEO 모드 칠판 재생 상태
  const [isVideoMode, setIsVideoMode] = useState<boolean>(false);
  const [videoSceneIdx, setVideoSceneIdx] = useState<number>(0);
  const [videoElapsed, setVideoElapsed] = useState<number>(0);
  const [videoPlaying, setVideoPlaying] = useState<boolean>(false);
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(true);
  const lastSpokenSceneRef = useRef<number>(-1);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boardContainerRef = useRef<HTMLDivElement | null>(null);

  const solve = solvePayload?.solve ?? null;
  const meta = solvePayload?.meta ?? null;

  // 새 풀이 결과가 오면 첫 번째 종합 칠판 페이지로 이동 & 영상 모드 해제
  useEffect(() => {
    setCurrentPageIdx(0);
    setIsVideoMode(false);
    setVideoPlaying(false);
    setShowCheckAnswer(false);
    setCheckAnswerInput('');
  }, [solvePayload]);

  // videoPayload가 새로 생성되면 자동으로 칠판 VIDEO 재생 모드로 진입
  useEffect(() => {
    if (videoPayload) {
      setIsVideoMode(true);
      setVideoSceneIdx(0);
      setVideoElapsed(0);
      setVideoPlaying(true);
      lastSpokenSceneRef.current = -1;
    }
  }, [videoPayload]);

  // 슬라이드 목록 생성 (#1 전체 판서, #2~ Step별 판서, 확인문제, 자유 메모장)
  const pages = useMemo(() => {
    const list: Array<{
      id: string;
      label: string;
      shortTitle: string;
      type: 'overview' | 'step' | 'check' | 'blank';
      stepIndex?: number;
      blankNo?: number;
    }> = [];

    list.push({
      id: 'page_overview',
      label: '#1',
      shortTitle: solve?.topic ? `종합: ${solve.topic.slice(0, 8)}` : '전체 판서',
      type: 'overview',
    });

    if (solve && solve.status === 'ok') {
      solve.steps.forEach((st, idx) => {
        list.push({
          id: `page_step_${st.no}`,
          label: `#${list.length + 1}`,
          shortTitle: `Step ${st.no}. ${st.title.slice(0, 7)}`,
          type: 'step',
          stepIndex: idx,
        });
      });

      list.push({
        id: 'page_check',
        label: `#${list.length + 1}`,
        shortTitle: '오답·확인문제',
        type: 'check',
      });
    }

    customBlankPages.forEach((bNo) => {
      list.push({
        id: `page_blank_${bNo}`,
        label: `#${list.length + 1}`,
        shortTitle: `자유 판서장 ${bNo}`,
        type: 'blank',
        blankNo: bNo,
      });
    });

    return list;
  }, [solve, customBlankPages]);

  const activePage = pages[Math.min(currentPageIdx, pages.length - 1)] ?? pages[0];
  const activePageStrokes = useMemo(
    () => strokesByPage[activePage.id] ?? [],
    [strokesByPage, activePage.id],
  );

  // VIDEO 재생 타이머 및 음성(TTS)
  const currentVideoScene =
    videoPayload?.video.scenes[videoSceneIdx] ?? videoPayload?.video.scenes[0];

  useEffect(() => {
    if (
      !isVideoMode ||
      !videoPlaying ||
      !ttsEnabled ||
      !currentVideoScene ||
      typeof window === 'undefined' ||
      !('speechSynthesis' in window)
    ) {
      return;
    }
    if (lastSpokenSceneRef.current === videoSceneIdx && videoElapsed > 0.3) {
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(currentVideoScene.narration);
    utter.lang = 'ko-KR';
    utter.rate = mode === 'kid' ? 0.95 : 1.05;
    utter.pitch = mode === 'kid' ? 1.12 : 1.0;
    window.speechSynthesis.speak(utter);
    lastSpokenSceneRef.current = videoSceneIdx;

    return () => {
      window.speechSynthesis.cancel();
    };
  }, [isVideoMode, videoPlaying, ttsEnabled, currentVideoScene, videoSceneIdx, videoElapsed, mode]);

  useEffect(() => {
    if (!isVideoMode || !videoPlaying || !currentVideoScene || !videoPayload) return;
    const timer = window.setInterval(() => {
      setVideoElapsed((prev) => {
        const next = prev + 0.1;
        if (next >= currentVideoScene.seconds) {
          if (videoSceneIdx < videoPayload.video.scenes.length - 1) {
            setVideoSceneIdx((s) => s + 1);
            return 0;
          } else {
            setVideoPlaying(false);
            return currentVideoScene.seconds;
          }
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [isVideoMode, videoPlaying, currentVideoScene, videoSceneIdx, videoPayload]);

  // VIDEO 현재 장면의 board_actions 계산
  const videoBoardState = useMemo(() => {
    if (!currentVideoScene) return { items: [], arrows: [] };
    const map = new Map<
      string,
      {
        id: string;
        text: string;
        x: number;
        y: number;
        underlined: boolean;
        circled: boolean;
        highlighted: boolean;
      }
    >();
    const arrows: Array<{ from: string; to: string }> = [];

    const sorted = [...currentVideoScene.board_actions].sort((a, b) => a.at - b.at);
    for (const act of sorted) {
      if (act.at > videoElapsed + 0.05) break;
      if (act.type === 'write') {
        map.set(act.id, {
          id: act.id,
          text: act.text,
          x: Math.min(0.86, Math.max(0.14, act.x)),
          y: Math.min(0.82, Math.max(0.16, act.y)),
          underlined: false,
          circled: false,
          highlighted: false,
        });
      } else if (act.type === 'underline') {
        const target = map.get(act.target);
        if (target) target.underlined = true;
      } else if (act.type === 'circle') {
        const target = map.get(act.target);
        if (target) target.circled = true;
      } else if (act.type === 'highlight') {
        const target = map.get(act.target);
        if (target) target.highlighted = true;
      } else if (act.type === 'arrow') {
        if (map.has(act.from) && map.has(act.to)) {
          arrows.push({ from: act.from, to: act.to });
        }
      } else if (act.type === 'erase') {
        if (act.target === 'all') {
          map.clear();
          arrows.length = 0;
        } else {
          map.delete(act.target);
        }
      }
    }
    return { items: Array.from(map.values()), arrows };
  }, [currentVideoScene, videoElapsed]);

  // 캔버스 리사이즈 및 스트로크 렌더링 (진짜 분필 질감 효과)
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = boardContainerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const allStrokes = currentStroke
      ? [...activePageStrokes, currentStroke]
      : activePageStrokes;

    const drawSingleStroke = (st: ChalkStroke) => {
      if (st.points.length === 0) return;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (st.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = 28;
        ctx.beginPath();
        st.points.forEach((pt, idx) => {
          const px = pt.x * rect.width;
          const py = pt.y * rect.height;
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.restore();
        return;
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = st.color;
      ctx.fillStyle = st.color;
      ctx.lineWidth = st.tool === 'highlighter' ? 18 : st.width;
      ctx.globalAlpha = st.tool === 'highlighter' ? 0.32 : 0.92;

      // 분필 거친 입자 느낌을 위한 그림자 블러
      if (st.tool !== 'highlighter') {
        ctx.shadowColor = st.color;
        ctx.shadowBlur = 1.5;
      }

      if (st.tool === 'text' && st.text) {
        const p0 = st.points[0];
        ctx.font = 'bold 20px "Pretendard", "Malgun Gothic", sans-serif';
        ctx.fillText(st.text, p0.x * rect.width, p0.y * rect.height);
        ctx.restore();
        return;
      }

      if (st.tool === 'rect' && st.points.length >= 2) {
        const p0 = st.points[0];
        const p1 = st.points[st.points.length - 1];
        const x = p0.x * rect.width;
        const y = p0.y * rect.height;
        const w = (p1.x - p0.x) * rect.width;
        const h = (p1.y - p0.y) * rect.height;
        ctx.setLineDash([8, 6]); // 사진 속 점선 사각형 스타일!
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
        return;
      }

      if (st.tool === 'circle' && st.points.length >= 2) {
        const p0 = st.points[0];
        const p1 = st.points[st.points.length - 1];
        const cx = ((p0.x + p1.x) / 2) * rect.width;
        const cy = ((p0.y + p1.y) / 2) * rect.height;
        const rx = Math.abs((p1.x - p0.x) * rect.width) / 2;
        const ry = Math.abs((p1.y - p0.y) * rect.height) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(4, rx), Math.max(4, ry), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (st.tool === 'arrow' && st.points.length >= 2) {
        const p0 = st.points[0];
        const p1 = st.points[st.points.length - 1];
        const x1 = p0.x * rect.width;
        const y1 = p0.y * rect.height;
        const x2 = p1.x * rect.width;
        const y2 = p1.y * rect.height;

        ctx.setLineDash([8, 6]); // 사진 속 점선 화살표 스타일!
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // 화살촉
        ctx.setLineDash([]);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const headLen = 14;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(
          x2 - headLen * Math.cos(angle - Math.PI / 6),
          y2 - headLen * Math.sin(angle - Math.PI / 6),
        );
        ctx.lineTo(
          x2 - headLen * Math.cos(angle + Math.PI / 6),
          y2 - headLen * Math.sin(angle + Math.PI / 6),
        );
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
        return;
      }

      // 일반 분필 자유곡선 (pen / highlighter)
      ctx.beginPath();
      st.points.forEach((pt, idx) => {
        const px = pt.x * rect.width;
        const py = pt.y * rect.height;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    };

    allStrokes.forEach(drawSingleStroke);
  }, [activePageStrokes, currentStroke, currentPageIdx, zoom]);

  // 포인터 좌표 정규화 (0~1)
  const getNormalizedPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activeTool === 'select') return;
    const pt = getNormalizedPoint(e);

    if (activeTool === 'text') {
      setPendingTextPos(pt);
      setPendingTextValue('');
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    setCurrentStroke({
      id: `st_${Date.now()}`,
      tool: activeTool,
      color: chalkColor,
      width: strokeWidth,
      points: [pt],
    });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!currentStroke) return;
    const pt = getNormalizedPoint(e);
    setCurrentStroke((prev) => {
      if (!prev) return null;
      if (prev.tool === 'rect' || prev.tool === 'circle' || prev.tool === 'arrow') {
        return { ...prev, points: [prev.points[0], pt] };
      }
      return { ...prev, points: [...prev.points, pt] };
    });
  };

  const handlePointerUp = () => {
    if (!currentStroke) return;
    const pageId = activePage.id;
    setStrokesByPage((prev) => ({
      ...prev,
      [pageId]: [...(prev[pageId] ?? []), currentStroke],
    }));
    setCurrentStroke(null);
  };

  const handleCommitTextMemo = () => {
    if (!pendingTextPos || !pendingTextValue.trim()) {
      setPendingTextPos(null);
      return;
    }
    const pageId = activePage.id;
    const newStroke: ChalkStroke = {
      id: `txt_${Date.now()}`,
      tool: 'text',
      color: chalkColor,
      width: strokeWidth,
      points: [pendingTextPos],
      text: pendingTextValue.trim(),
    };
    setStrokesByPage((prev) => ({
      ...prev,
      [pageId]: [...(prev[pageId] ?? []), newStroke],
    }));
    setPendingTextPos(null);
    setPendingTextValue('');
  };

  const handleUndo = () => {
    triggerAitHaptic('tap');
    const pageId = activePage.id;
    setStrokesByPage((prev) => {
      const list = prev[pageId] ?? [];
      if (list.length === 0) return prev;
      return { ...prev, [pageId]: list.slice(0, -1) };
    });
  };

  const handleClearCurrentBoard = () => {
    triggerAitHaptic('warning');
    const pageId = activePage.id;
    setStrokesByPage((prev) => ({
      ...prev,
      [pageId]: [],
    }));
  };

  const handleAddBlankPage = () => {
    triggerAitHaptic('tap');
    const nextNo = customBlankPages.length + 1;
    setCustomBlankPages((prev) => [...prev, nextNo]);
    setCurrentPageIdx(pages.length); // 새로 생성된 페이지로 즉시 이동
  };

  const handleAddNewTab = () => {
    triggerAitHaptic('tap');
    const nextIdx = boardTabs.length + 1;
    const newTab: MemoBoardTab = {
      id: `tab-${Date.now()}`,
      title: `Tab #${nextIdx}`,
      mode,
      action,
      question: questionInput,
    };
    setBoardTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const formattedTime = nowTime.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const formattedDate = nowTime.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
  });

  return (
    <div className="h-dvh w-screen overflow-hidden bg-[#161514] p-1 sm:p-2.5 flex flex-col select-none">
      {/* 전자칠판 메탈 베젤 본체 프레임 */}
      <div className="relative flex-1 flex flex-col rounded-lg border-[6px] sm:border-[10px] border-[#2c2a29] shadow-[0_0_50px_rgba(0,0,0,0.95),inset_0_0_12px_rgba(0,0,0,0.8)] overflow-hidden bg-[#1f2221]">
        {/* 상단 중앙 카메라 센서 점 (전자칠판 하드웨어 디테일) */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-40 w-10 h-1.5 bg-[#181716] rounded-b-md flex items-center justify-center">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/70" />
        </div>

        {/* 내부: 좌측 수직 도구 독(Dock) + 우측 대형 흑판 + 하단 썸네일 바 */}
        <div className="flex-1 flex min-h-0">
          {/* ================= 좌측 전자칠판 수직 툴바 (사진 속 좌측 패널 완벽 재현) ================= */}
          <aside className="w-14 sm:w-20 bg-[#1e201f]/95 border-r border-white/10 flex flex-col items-center py-2.5 px-1.5 justify-between z-30 shrink-0">
            {/* 상단: 날짜/시계 + 브랜드 + 미니 페이지 프리뷰 */}
            <div className="w-full flex flex-col items-center space-y-2">
              <div className="text-center leading-tight">
                <div className="text-[9px] sm:text-[10px] text-slate-400 font-medium">
                  {formattedDate}
                </div>
                <div className="text-[11px] sm:text-xs font-extrabold text-slate-100 tracking-tight">
                  {formattedTime}
                </div>
              </div>

              <div className="text-[10px] sm:text-xs font-black tracking-widest text-slate-300 border-y border-white/10 py-1 w-full text-center">
                AIBOARD
              </div>

              {/* 현재 페이지 카운터 (1 / N) */}
              <div className="flex items-center justify-between w-full px-1 text-[10px] text-slate-300 font-bold">
                <button
                  type="button"
                  onClick={() => setCurrentPageIdx((i) => Math.max(0, i - 1))}
                  disabled={currentPageIdx === 0}
                  className="hover:text-white disabled:opacity-30 cursor-pointer"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>
                <span>
                  {currentPageIdx + 1}/{pages.length}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCurrentPageIdx((i) => Math.min(pages.length - 1, i + 1))
                  }
                  disabled={currentPageIdx === pages.length - 1}
                  className="hover:text-white disabled:opacity-30 cursor-pointer"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              {/* 사진 속 빨간 테두리 미니 칠판 프리뷰 박스 */}
              <div
                onClick={() => setIsVideoMode(false)}
                className="w-full aspect-video rounded border-2 border-rose-500/80 bg-[#252827] p-1 flex flex-col items-center justify-center text-center cursor-pointer shadow-inner"
                title="현재 칠판 슬라이드 미리보기"
              >
                <span className="text-[9px] text-amber-200 font-bold line-clamp-1">
                  {activePage.label}
                </span>
                <span className="text-[8px] text-slate-300 line-clamp-1">
                  {activePage.shortTitle}
                </span>
              </div>

              {/* 배율 표시 */}
              <div className="w-full py-0.5 rounded bg-black/40 border border-white/10 text-[9px] text-center text-slate-300 font-semibold">
                {zoom}%
              </div>
            </div>

            {/* 중단: 전자칠판 기능 & 분필 필기 도구 아이콘 그리드 (2열 배치) */}
            <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-1.5 my-auto py-2">
              {/* 선택(포인터) */}
              <button
                type="button"
                onClick={() => setActiveTool('select')}
                title="포인터 / 화면 조작 모드"
                className={`p-1.5 rounded flex items-center justify-center transition cursor-pointer ${
                  activeTool === 'select'
                    ? 'bg-emerald-500/30 text-emerald-300 ring-1 ring-emerald-400'
                    : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                <MousePointer className="w-4 h-4" />
              </button>

              {/* 분필 펜 (사진 속 하얀 테두리 선택된 펜 아이콘) */}
              <button
                type="button"
                onClick={() => setActiveTool('pen')}
                title="분필 필기 (칠판 위에 직접 쓰기)"
                className={`p-1.5 rounded flex items-center justify-center transition cursor-pointer ${
                  activeTool === 'pen'
                    ? 'bg-white/20 text-white ring-2 ring-white shadow'
                    : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                <Pencil className="w-4 h-4" />
              </button>

              {/* 형광펜 */}
              <button
                type="button"
                onClick={() => setActiveTool('highlighter')}
                title="분필 형광펜 강조"
                className={`p-1.5 rounded flex items-center justify-center transition cursor-pointer ${
                  activeTool === 'highlighter'
                    ? 'bg-amber-400/30 text-amber-300 ring-1 ring-amber-300'
                    : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                <Highlighter className="w-4 h-4" />
              </button>

              {/* 지우개 */}
              <button
                type="button"
                onClick={() => setActiveTool('eraser')}
                title="칠판 부분 지우개"
                className={`p-1.5 rounded flex items-center justify-center transition cursor-pointer ${
                  activeTool === 'eraser'
                    ? 'bg-rose-500/30 text-rose-300 ring-1 ring-rose-400'
                    : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                <Eraser className="w-4 h-4" />
              </button>

              {/* 텍스트 메모 */}
              <button
                type="button"
                onClick={() => setActiveTool('text')}
                title="칠판 원하는 위치를 클릭해 분필 텍스트 메모 넣기"
                className={`p-1.5 rounded flex items-center justify-center transition cursor-pointer ${
                  activeTool === 'text'
                    ? 'bg-sky-500/30 text-sky-300 ring-1 ring-sky-400'
                    : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                <Type className="w-4 h-4" />
              </button>

              {/* 점선 화살표 그리기 (사진 속 점선 화살표 도구!) */}
              <button
                type="button"
                onClick={() => setActiveTool('arrow')}
                title="점선 화살표 그리기"
                className={`p-1.5 rounded flex items-center justify-center transition cursor-pointer ${
                  activeTool === 'arrow'
                    ? 'bg-amber-500/30 text-amber-200 ring-1 ring-amber-400'
                    : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                <ArrowUpRight className="w-4 h-4" />
              </button>

              {/* 점선 사각형 (□) */}
              <button
                type="button"
                onClick={() => setActiveTool('rect')}
                title="점선 사각형 박스 그리기"
                className={`p-1.5 rounded flex items-center justify-center transition cursor-pointer ${
                  activeTool === 'rect'
                    ? 'bg-white/25 text-white ring-1 ring-white'
                    : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                <Square className="w-4 h-4" />
              </button>

              {/* 동그라미 (○) */}
              <button
                type="button"
                onClick={() => setActiveTool('circle')}
                title="분필 동그라미 강조"
                className={`p-1.5 rounded flex items-center justify-center transition cursor-pointer ${
                  activeTool === 'circle'
                    ? 'bg-amber-400/25 text-amber-300 ring-1 ring-amber-300'
                    : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                <Circle className="w-4 h-4" />
              </button>

              {/* 격자 보조선 */}
              <button
                type="button"
                onClick={() => setShowGrid((g) => !g)}
                title="칠판 모눈 격자 보조선 켜기/끄기"
                className={`p-1.5 rounded flex items-center justify-center transition cursor-pointer ${
                  showGrid
                    ? 'bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-400'
                    : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                <Grid className="w-4 h-4" />
              </button>

              {/* 실행 취소 (Undo) */}
              <button
                type="button"
                onClick={handleUndo}
                title="방금 그린 분필 선 되돌리기"
                className="p-1.5 rounded flex items-center justify-center text-slate-300 hover:bg-white/10 cursor-pointer"
              >
                <Undo2 className="w-4 h-4" />
              </button>

              {/* 현재 칠판 필기 전체 지우기 */}
              <button
                type="button"
                onClick={handleClearCurrentBoard}
                title="내 분필 필기 모두 지우기"
                className="p-1.5 rounded flex items-center justify-center text-rose-300 hover:bg-rose-500/20 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>

              {/* 공유하기 */}
              <button
                type="button"
                onClick={async () => {
                  if (!solve) return;
                  const ok = await shareChalkboardSummary({
                    topic: solve.topic,
                    answer: solve.answer,
                  });
                  if (ok) {
                    setSharedToast(true);
                    window.setTimeout(() => setSharedToast(false), 2000);
                  }
                }}
                title="칠판 판서 내용 공유/복사"
                className="p-1.5 rounded flex items-center justify-center text-emerald-300 hover:bg-emerald-500/20 cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>

            {/* 하단: 분필 색상 팔레트 & JSON 검증 인스펙터 버튼 */}
            <div className="w-full flex flex-col items-center gap-2 pt-1 border-t border-white/10">
              <div className="flex flex-wrap items-center justify-center gap-1">
                {CHALK_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => {
                      setChalkColor(c.value);
                      if (activeTool === 'select' || activeTool === 'eraser') {
                        setActiveTool('pen');
                      }
                    }}
                    title={c.name}
                    style={{ backgroundColor: c.value }}
                    className={`w-3.5 h-3.5 rounded-full transition cursor-pointer ${
                      chalkColor === c.value
                        ? 'ring-2 ring-white scale-110'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={onOpenInspector}
                title="서버 체크리스트 & JSON 검증 인스펙터 열기"
                className="w-full py-1 rounded bg-white/10 hover:bg-white/20 text-[9px] text-emerald-300 font-bold flex items-center justify-center gap-0.5 cursor-pointer"
              >
                <Code2 className="w-3 h-3" />
                <span className="hidden sm:inline">JSON검증</span>
              </button>
            </div>
          </aside>

          {/* ================= 우측 메인: 대형 칠판 보드 + 하단 슬라이드 바 ================= */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* 실제 분필 자국이 살아있는 흑판(Chalkboard) 스테이지 */}
            <div
              ref={boardContainerRef}
              className="relative flex-1 overflow-hidden"
              style={{
                backgroundColor: '#262928',
                backgroundImage: [
                  // 지우개로 문지른 듯한 분필 가루 구름 질감 (업로드 사진과 동일한 리얼 칠판 효과)
                  'radial-gradient(ellipse at 48% 42%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.06) 38%, rgba(0,0,0,0.25) 100%)',
                  'radial-gradient(ellipse at 22% 68%, rgba(255,255,255,0.09) 0%, transparent 55%)',
                  'radial-gradient(ellipse at 78% 28%, rgba(255,255,255,0.08) 0%, transparent 50%)',
                  'repeating-linear-gradient(-12deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 2px, transparent 2px, transparent 14px)',
                  'repeating-linear-gradient(4deg, rgba(255,255,255,0.018) 0px, rgba(255,255,255,0.018) 1px, transparent 1px, transparent 9px)',
                ].join(', '),
              }}
            >
              {/* 모눈 격자 보조선 (켜졌을 때만) */}
              {showGrid && (
                <div
                  className="absolute inset-0 pointer-events-none opacity-20"
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, rgba(255,255,255,0.2) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.2) 1px, transparent 1px)',
                    backgroundSize: '36px 36px',
                  }}
                />
              )}

              {/* 상단 칠판 컨트롤 & 질문 입력 칠판 바 (자유롭게 문제를 바꾸거나 모드를 전환) */}
              <div className="relative z-20 flex flex-wrap items-center justify-between gap-2 px-3 sm:px-5 pt-2.5 pb-1.5 border-b border-white/10 bg-black/20 backdrop-blur-[2px]">
                {/* 학습자 모드 (kid / high / adult) & 액션 분필 탭 */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: 'kid', label: '🐣 유아·어린이(kid)' },
                      { id: 'high', label: '🎓 고등 1타(high)' },
                      { id: 'adult', label: '💼 성인 실용(adult)' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onChangeMode(m.id)}
                      className={`px-2.5 py-1 rounded text-xs font-bold transition cursor-pointer ${
                        mode === m.id
                          ? 'bg-amber-300/25 text-amber-200 border border-amber-300/60 shadow'
                          : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-transparent'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}

                  <div className="h-4 w-px bg-white/15 mx-0.5 hidden sm:block" />

                  <button
                    type="button"
                    onClick={() =>
                      onChangeAction(action === 'solve' ? 'explain' : 'solve')
                    }
                    className="px-2 py-1 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-xs font-bold cursor-pointer"
                    title="풀이 중심(solve) / 개념 설명 중심(explain) 전환"
                  >
                    {action === 'solve' ? '✏️ 풀이(solve)' : '💡 개념(explain)'}
                  </button>
                </div>

                {/* 우측: 빠른 예제 칩 + 서버 수식 검증 배지 */}
                <div className="flex items-center gap-1.5 overflow-x-auto max-w-full">
                  {QUICK_PROBLEMS[mode].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        onChangeAction(item.action);
                        onChangeQuestionInput(item.q);
                        onSubmitQuestion(item.q, mode, item.action);
                      }}
                      className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[11px] text-slate-200 border border-white/15 shrink-0 cursor-pointer"
                    >
                      {item.label}
                    </button>
                  ))}

                  {meta && meta.verifyResults.length > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-[11px] text-emerald-200 font-semibold shrink-0">
                      <CheckCircle2 className="w-3 h-3" />
                      검산 완료
                    </span>
                  )}
                </div>
              </div>

              {/* 개인정보 마스킹 작동 알림 배너 (체크리스트 #6) */}
              {meta && meta.piiMaskedCount > 0 && (
                <div className="relative z-20 mx-4 mt-2 px-3 py-1.5 rounded bg-sky-950/80 border border-sky-400/40 text-xs text-sky-200 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-sky-300 shrink-0" />
                  <span>
                    개인정보({meta.piiTypes.join(', ')}) {meta.piiMaskedCount}건을 AI 호출 전{' '}
                    <code className="text-amber-200 font-bold">{meta.maskedQuestion}</code>로
                    안전 마스킹했습니다.
                  </span>
                </div>
              )}

              {/* 에러 메시지 */}
              {errorMsg && (
                <div className="relative z-20 mx-4 mt-2 px-3 py-2 rounded bg-rose-950/80 border border-rose-400/50 text-xs text-rose-200">
                  {errorMsg}
                </div>
              )}

              {/* ================= 칠판 메인 콘텐츠 레이어 (AI 판서 내용) ================= */}
              <div
                className="relative z-10 h-[calc(100%-3rem)] w-full p-3 sm:p-6 overflow-y-auto"
                style={{
                  transform: `scale(${zoom / 100})`,
                  transformOrigin: 'top left',
                }}
              >
                {/* 로딩 중 */}
                {isSolving && (
                  <div className="h-full flex flex-col items-center justify-center text-white/90 gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-amber-300" />
                    <p className="text-sm sm:text-base font-bold tracking-wide">
                      선생님이 칠판에 분필로 단계별 판서를 적고 검산하고 있어요...
                    </p>
                  </div>
                )}

                {/* VIDEO 판서 재생 모드일 때 */}
                {!isSolving && isVideoMode && videoPayload && currentVideoScene && (
                  <div className="relative h-full w-full flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="px-3 py-1 rounded-full bg-amber-300/20 border border-amber-300/50 text-amber-200 text-xs font-bold">
                        🎬 실시간 강의 판서 Scene #{currentVideoScene.scene}/
                        {videoPayload.video.scenes.length} (Step {currentVideoScene.step_ref})
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setTtsEnabled((v) => !v)}
                          className="px-2.5 py-1 rounded bg-white/10 text-xs text-white flex items-center gap-1 cursor-pointer"
                        >
                          {ttsEnabled ? (
                            <>
                              <Volume2 className="w-3.5 h-3.5 text-emerald-300" /> 음성 ON
                            </>
                          ) : (
                            <>
                              <VolumeX className="w-3.5 h-3.5 text-slate-400" /> 음성 OFF
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                              window.speechSynthesis.cancel();
                            }
                            setIsVideoMode(false);
                            setVideoPlaying(false);
                          }}
                          className="px-2.5 py-1 rounded bg-white/15 hover:bg-white/25 text-xs font-bold text-white cursor-pointer"
                        >
                          칠판 Step 보기로 돌아가기
                        </button>
                      </div>
                    </div>

                    {/* VIDEO 판서 액션 캔버스 영역 */}
                    <div className="relative flex-1 my-2">
                      <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
                        <defs>
                          <marker
                            id="video-chalk-arrow"
                            markerWidth="8"
                            markerHeight="8"
                            refX="6"
                            refY="4"
                            orient="auto"
                          >
                            <path d="M0,0 L8,4 L0,8 Z" fill="#fde047" />
                          </marker>
                        </defs>
                        {videoBoardState.arrows.map((ar, idx) => {
                          const fromItem = videoBoardState.items.find((w) => w.id === ar.from);
                          const toItem = videoBoardState.items.find((w) => w.id === ar.to);
                          if (!fromItem || !toItem) return null;
                          return (
                            <line
                              key={idx}
                              x1={`${fromItem.x * 100}%`}
                              y1={`${(fromItem.y + 0.04) * 100}%`}
                              x2={`${toItem.x * 100}%`}
                              y2={`${(toItem.y - 0.05) * 100}%`}
                              stroke="#fde047"
                              strokeWidth="3"
                              strokeDasharray="7,5"
                              markerEnd="url(#video-chalk-arrow)"
                            />
                          );
                        })}
                      </svg>

                      {videoBoardState.items.map((item) => (
                        <div
                          key={item.id}
                          style={{
                            left: `${item.x * 100}%`,
                            top: `${item.y * 100}%`,
                            transform: 'translate(-50%, -50%)',
                          }}
                          className="absolute z-20 max-w-[85%] text-center animate-fadeIn"
                        >
                          <div
                            className={[
                              'inline-block px-4 py-2 rounded-lg text-white font-bold text-lg sm:text-2xl tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]',
                              item.highlighted
                                ? 'bg-amber-300/25 text-amber-100 border border-amber-300/50'
                                : '',
                              item.underlined
                                ? 'underline decoration-amber-300 decoration-wavy decoration-2 underline-offset-8'
                                : '',
                              item.circled
                                ? 'ring-3 ring-rose-300 rounded-full px-6 py-2.5 bg-rose-500/10'
                                : '',
                            ].join(' ')}
                          >
                            <MathText text={item.text} />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* 하단 강사 나레이션 분필 자막 바 */}
                    <div className="rounded-xl bg-black/65 border border-white/20 px-4 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-3">
                      <p className="text-xs sm:text-sm text-amber-100 font-medium">
                        👨‍🏫 &ldquo;{currentVideoScene.narration}&rdquo;
                      </p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setVideoPlaying((p) => !p)}
                          className="px-3 py-1 rounded bg-emerald-500 text-slate-950 font-extrabold text-xs flex items-center gap-1 cursor-pointer"
                        >
                          {videoPlaying ? (
                            <>
                              <Pause className="w-3.5 h-3.5" /> 일시정지
                            </>
                          ) : (
                            <>
                              <Play className="w-3.5 h-3.5" /> 계속 재생
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            lastSpokenSceneRef.current = -1;
                            setVideoSceneIdx(0);
                            setVideoElapsed(0);
                            setVideoPlaying(true);
                          }}
                          className="p-1.5 rounded bg-white/10 text-white hover:bg-white/20 cursor-pointer"
                          title="영상 처음부터"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 일반 칠판 판서 모드 (사진과 동일한 좌상단 문제 인셋 박스 + 점선 화살표 + 칠판 판서) */}
                {!isSolving && !isVideoMode && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
                    {/* 좌상단 문제 카드 (업로드해주신 사진 좌상단의 점선 사각형 + 점선 화살표 구도!) */}
                    <div className="lg:col-span-4 relative">
                      <div className="rounded-lg bg-[#1d3247]/90 border-2 border-slate-300/40 p-3.5 shadow-xl">
                        <div className="flex items-center justify-between text-[11px] text-sky-200 font-bold mb-2">
                          <span>📌 오늘의 질문 / 문제 메모</span>
                          <span className="px-1.5 py-0.5 rounded bg-black/30 text-amber-200">
                            TASK=SOLVE
                          </span>
                        </div>

                        {/* 점선 사각형 하이라이트 박스 (사진 속 흰색 점선 테두리 완벽 재현!) */}
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            onSubmitQuestion(questionInput);
                          }}
                          className="rounded-xl border-[3px] border-dashed border-white/95 bg-black/35 p-3 space-y-2 shadow-[0_0_15px_rgba(255,255,255,0.15)]"
                        >
                          <input
                            type="text"
                            value={questionInput}
                            onChange={(e) => onChangeQuestionInput(e.target.value)}
                            placeholder="칠판에 풀 문제를 적으세요..."
                            className="w-full bg-transparent text-white font-extrabold text-base sm:text-lg focus:outline-none placeholder:text-slate-400"
                          />
                          <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/15">
                            <span className="text-[11px] text-amber-200 font-medium truncate">
                              {solve ? `주제: ${solve.topic}` : '문제를 입력해 주세요'}
                            </span>
                            <button
                              type="submit"
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-300 hover:bg-amber-200 text-slate-950 font-black text-xs shrink-0 cursor-pointer"
                            >
                              <Send className="w-3 h-3" />
                              칠판 판서
                            </button>
                          </div>
                        </form>

                        <p className="text-[11px] text-slate-300 mt-2 leading-snug">
                          💡 좌측 도구함의 <strong>분필 펜(✏️)·점선박스(□)·화살표(↗)·텍스트(T)</strong>를
                          선택해 칠판 아무 곳에나 직접 필기하며 메모할 수 있어요!
                        </p>
                      </div>

                      {/* 사진 속 좌상단 박스에서 칠판 중앙으로 뻗어나가는 흰색 점선 화살표 SVG */}
                      <svg
                        className="hidden lg:block w-36 h-24 ml-16 -mt-1 pointer-events-none"
                        viewBox="0 0 150 95"
                      >
                        <line
                          x1="10"
                          y1="5"
                          x2="115"
                          y2="78"
                          stroke="#ffffff"
                          strokeWidth="4"
                          strokeDasharray="10,8"
                          strokeLinecap="round"
                        />
                        <polygon
                          points="130,88 106,84 119,65"
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth="4"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>

                    {/* 우측/중앙 칠판 판서 본문 영역 */}
                    <div className="lg:col-span-8 space-y-4">
                      {/* 1) status === "clarify" 되묻기 칠판 (체크리스트 #3) */}
                      {solve && solve.status === 'clarify' && (
                        <div className="rounded-xl border-2 border-dashed border-amber-300/80 bg-black/30 p-5 text-white space-y-3">
                          <div className="flex items-center gap-2 text-amber-300 font-extrabold text-base">
                            <HelpCircle className="w-5 h-5" />
                            <span>선생님의 되묻기 (status=&quot;clarify&quot;)</span>
                          </div>
                          <p className="text-lg font-bold text-white">
                            &ldquo;{solve.clarify_question}&rdquo;
                          </p>
                          <div className="flex flex-wrap gap-2 pt-1">
                            {(mode === 'kid'
                              ? ['1 + 1 = ?', '3 + 5 = ?']
                              : ['x^2 - 5x + 6 = 0', '피타고라스 정리', '(12 + 8) * 3 = ?']
                            ).map((sample) => (
                              <button
                                key={sample}
                                type="button"
                                onClick={() => {
                                  onChangeQuestionInput(sample);
                                  onSubmitQuestion(sample);
                                }}
                                className="px-3 py-1.5 rounded-lg bg-amber-300/20 hover:bg-amber-300/30 border border-amber-300/50 text-xs font-bold text-amber-100 cursor-pointer"
                              >
                                👉 {sample} 로 질문하기
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 2) status === "unsupported" 안내 칠판 (체크리스트 #3) */}
                      {solve && solve.status === 'unsupported' && (
                        <div className="rounded-xl border-2 border-dashed border-rose-400/80 bg-black/30 p-5 text-white space-y-3">
                          <div className="flex items-center gap-2 text-rose-300 font-extrabold text-base">
                            <ShieldAlert className="w-5 h-5" />
                            <span>지원하지 않는 요청 안내 (status=&quot;unsupported&quot;)</span>
                          </div>
                          <p className="text-base font-bold text-rose-100">{solve.answer}</p>
                          <button
                            type="button"
                            onClick={() => {
                              const nextQ = mode === 'kid' ? '1+1=?' : 'x^2 - 5x + 6 = 0';
                              onChangeQuestionInput(nextQ);
                              onSubmitQuestion(nextQ);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500/25 border border-emerald-400/50 text-xs font-bold text-emerald-200 cursor-pointer"
                          >
                            기본 수학 판서 문제로 돌아가기
                          </button>
                        </div>
                      )}

                      {/* 3) status === "ok" 판서 렌더링 (현재 선택된 하단 슬라이드 페이지 기준) */}
                      {solve && solve.status === 'ok' && activePage.type === 'overview' && (
                        <div className="space-y-4">
                          {/* 칠판 상단 대제목 */}
                          <div className="border-b-2 border-dashed border-white/25 pb-2 flex flex-wrap items-center justify-between gap-2">
                            <h2 className="text-xl sm:text-2xl font-black text-amber-200 tracking-wide drop-shadow">
                              [판서 주제] <MathText text={solve.topic} />
                            </h2>
                            <span className="text-xs text-emerald-300 font-bold">
                              하단 #1~#{pages.length} 슬라이드를 눌러 단계별 칠판으로 이동 가능
                            </span>
                          </div>

                          {/* Step 1 ~ N 분필 판서 그리드 */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            {solve.steps.map((st, sIdx) => (
                              <div
                                key={st.no}
                                onClick={() => {
                                  if (activeTool === 'select') {
                                    setCurrentPageIdx(sIdx + 1);
                                  }
                                }}
                                className="rounded-xl border border-white/20 bg-black/25 p-3.5 space-y-2 hover:border-amber-300/60 transition"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-xs sm:text-sm font-extrabold text-amber-300 underline decoration-wavy decoration-amber-300/60 underline-offset-4">
                                    Step {st.no}. {st.title}
                                  </span>
                                </div>

                                {/* 실제 칠판에 쓰는 줄 (최대 3줄) */}
                                <div className="pl-2 border-l-2 border-emerald-400/60 space-y-1 py-1">
                                  {st.board.map((line, lIdx) => (
                                    <div
                                      key={lIdx}
                                      className="text-base sm:text-xl font-bold text-white tracking-wide"
                                    >
                                      <MathText text={line} highlights={st.highlight} />
                                    </div>
                                  ))}
                                </div>

                                {/* 선생님의 말로 하는 설명 */}
                                <p className="text-xs text-slate-200/90 leading-relaxed">
                                  🗣️ <MathText text={st.explain} highlights={st.highlight} />
                                </p>
                              </div>
                            ))}
                          </div>

                          {/* 최종 정답 분필 박스 & 흔한 실수 */}
                          <div className="rounded-xl border-2 border-amber-300/70 bg-black/35 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                              <span className="px-2.5 py-1 rounded bg-amber-300 text-slate-950 font-black text-xs">
                                최종 정답
                              </span>
                              <span className="text-lg sm:text-2xl font-black text-amber-200">
                                <MathText text={solve.answer} />
                              </span>
                            </div>

                            {solve.common_mistake && (
                              <div className="text-xs text-rose-200 flex items-center gap-1.5">
                                <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0" />
                                <span>
                                  <strong>주의:</strong> <MathText text={solve.common_mistake} />
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 개별 Step 집중 칠판 슬라이드 (#2, #3...) */}
                      {solve &&
                        solve.status === 'ok' &&
                        activePage.type === 'step' &&
                        typeof activePage.stepIndex === 'number' && (
                          <div className="space-y-5 p-2">
                            {(() => {
                              const st = solve.steps[activePage.stepIndex] ?? solve.steps[0];
                              return (
                                <>
                                  <div className="inline-block px-3 py-1 rounded border border-amber-300/60 bg-amber-300/15 text-amber-200 font-extrabold text-sm">
                                    Step {st.no} 집중 판서 · {st.title}
                                  </div>

                                  <div className="rounded-2xl border-2 border-dashed border-white/40 bg-black/25 p-6 space-y-4">
                                    {st.board.map((line, idx) => (
                                      <div
                                        key={idx}
                                        className="text-2xl sm:text-4xl font-black text-white tracking-wider leading-relaxed"
                                      >
                                        <MathText text={line} highlights={st.highlight} />
                                      </div>
                                    ))}
                                  </div>

                                  <div className="rounded-xl bg-black/35 border border-emerald-400/40 p-4 text-sm sm:text-base text-emerald-100 leading-relaxed">
                                    👨‍🏫 <strong>선생님 설명:</strong>{' '}
                                    <MathText text={st.explain} highlights={st.highlight} />
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        )}

                      {/* 오답노트 & 확인문제 슬라이드 */}
                      {solve && solve.status === 'ok' && activePage.type === 'check' && (
                        <div className="space-y-4 p-2">
                          <div className="rounded-xl border-2 border-rose-400/50 bg-black/30 p-4 space-y-2">
                            <div className="text-sm font-extrabold text-rose-300 flex items-center gap-1.5">
                              <AlertTriangle className="w-4 h-4" />
                              <span>1타 강사 오답노트 (학생이 자주 틀리는 지점)</span>
                            </div>
                            <p className="text-base sm:text-lg text-white font-bold">
                              <MathText text={solve.common_mistake} />
                            </p>
                          </div>

                          {solve.check_question && (
                            <div className="rounded-xl border-2 border-dashed border-amber-300/70 bg-black/30 p-4 space-y-3">
                              <div className="text-sm font-extrabold text-amber-300">
                                ✏️ 칠판 확인문제 (직접 위 칠판에 분필로 풀어보세요!)
                              </div>
                              <p className="text-lg sm:text-xl font-bold text-white">
                                Q. <MathText text={solve.check_question.q} />
                              </p>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={checkAnswerInput}
                                  onChange={(e) => setCheckAnswerInput(e.target.value)}
                                  placeholder="정답을 입력하거나 칠판에 직접 적어보세요"
                                  className="flex-1 rounded-lg bg-black/50 border border-white/25 px-3 py-2 text-sm text-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowCheckAnswer((s) => !s)}
                                  className="px-4 py-2 rounded-lg bg-amber-300 text-slate-950 font-black text-xs cursor-pointer"
                                >
                                  {showCheckAnswer ? '정답 숨기기' : '정답 맞추기'}
                                </button>
                              </div>
                              {showCheckAnswer && (
                                <div className="p-3 rounded-lg bg-emerald-950/70 border border-emerald-400/50 text-sm text-emerald-200 font-bold">
                                  정답: <MathText text={solve.check_question.a} />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 사용자 추가 빈 자유 칠판 메모장 */}
                      {activePage.type === 'blank' && (
                        <div className="p-4 rounded-xl border border-dashed border-white/20 bg-black/15 text-slate-300 text-xs sm:text-sm">
                          <strong className="text-amber-200">
                            📝 자유 판서 메모장 #{activePage.blankNo}
                          </strong>{' '}
                          — 좌측의 분필 펜(✏️), 점선 네모(□), 화살표(↗), 텍스트(T) 도구로 칠판 전체에
                          자유롭게 필기하세요.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ================= 사용자 분필 드로잉 투명 캔버스 레이어 (언제든 칠판 위에 필기 가능!) ================= */}
              <canvas
                ref={canvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className={`absolute inset-0 w-full h-full z-25 ${
                  activeTool === 'select'
                    ? 'pointer-events-none'
                    : activeTool === 'eraser'
                      ? 'cursor-cell'
                      : 'cursor-crosshair'
                }`}
              />

              {/* 텍스트 메모(T) 클릭 시 입력 팝오버 */}
              {pendingTextPos && (
                <div
                  style={{
                    left: `${pendingTextPos.x * 100}%`,
                    top: `${pendingTextPos.y * 100}%`,
                  }}
                  className="absolute z-40 -translate-y-1/2 bg-slate-900/95 border-2 border-amber-300 rounded-lg p-2 shadow-2xl flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    autoFocus
                    value={pendingTextValue}
                    onChange={(e) => setPendingTextValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCommitTextMemo();
                      if (e.key === 'Escape') setPendingTextPos(null);
                    }}
                    placeholder="칠판 분필 메모 입력..."
                    className="bg-black/60 text-white text-xs px-2 py-1 rounded border border-white/20 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCommitTextMemo}
                    className="px-2 py-1 rounded bg-amber-300 text-slate-950 text-xs font-bold cursor-pointer"
                  >
                    쓰기
                  </button>
                </div>
              )}

              {/* 공유 완료 토스트 */}
              {sharedToast && (
                <div className="absolute top-14 right-4 z-40 px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold text-xs shadow-lg">
                  칠판 판서 내용이 공유/복사되었습니다!
                </div>
              )}
            </div>

            {/* ================= 하단 탭 & 칠판 슬라이드 썸네일 독 (사진 하단 구성 완벽 재현!) ================= */}
            <div className="bg-[#1b1d1c] border-t border-white/15 flex flex-col z-30 shrink-0">
              {/* 상단 얇은 탭 줄: Tab #1 + */}
              <div className="flex items-center justify-between px-3 py-1 bg-[#141615] border-b border-white/10 text-[11px]">
                <div className="flex items-center gap-1 overflow-x-auto">
                  {boardTabs.map((t) => {
                    const isAct = t.id === activeTabId;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setActiveTabId(t.id);
                          onChangeMode(t.mode);
                          onChangeAction(t.action);
                          onChangeQuestionInput(t.question);
                        }}
                        className={`px-3 py-0.5 rounded-t font-bold transition cursor-pointer ${
                          isAct
                            ? 'bg-[#1b1d1c] text-sky-400 border-b-2 border-sky-400'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {t.title}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={handleAddNewTab}
                    title="새 칠판 문제 탭 열기"
                    className="px-2 py-0.5 text-slate-400 hover:text-white cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 우측: 현재 선택된 판서 도구 상태 안내 */}
                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                  <span>
                    현재 도구:{' '}
                    <strong className="text-amber-200 uppercase">{activeTool}</strong>
                    {activeTool !== 'select' && ' (칠판 위에 바로 드래그하여 필기하세요)'}
                  </span>
                </div>
              </div>

              {/* 하단 메인 썸네일 스트립: #1, #2, #3, #4, #5 + [새 칠판 추가] --- 우측 [▶ 영상 강의] [+ / -] */}
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                {/* 좌측~중앙: 칠판 슬라이드 썸네일 리스트 */}
                <div className="flex items-center gap-2 overflow-x-auto py-0.5">
                  <button
                    type="button"
                    onClick={() => setCurrentPageIdx((i) => Math.max(0, i - 1))}
                    disabled={currentPageIdx === 0}
                    className="p-1 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  {pages.map((p, idx) => {
                    const isSelected = !isVideoMode && idx === currentPageIdx;
                    const strokeCount = (strokesByPage[p.id] ?? []).length;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          triggerAitHaptic('tap');
                          setIsVideoMode(false);
                          setCurrentPageIdx(idx);
                        }}
                        className="group flex flex-col items-center gap-0.5 shrink-0 cursor-pointer"
                      >
                        <div
                          className={`w-20 sm:w-24 h-12 sm:h-14 rounded border-2 p-1.5 flex flex-col justify-between text-left transition relative overflow-hidden ${
                            isSelected
                              ? 'border-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.45)]'
                              : 'border-white/20 opacity-80 hover:opacity-100'
                          }`}
                          style={{
                            background:
                              'radial-gradient(circle at 50% 45%, #37423f 0%, #232726 100%)',
                          }}
                        >
                          <div className="text-[9px] font-bold text-amber-200 truncate">
                            {p.shortTitle}
                          </div>
                          <div className="flex items-center justify-between text-[8px] text-slate-300">
                            <span>{p.type === 'blank' ? '메모 칠판' : 'AI 판서'}</span>
                            {strokeCount > 0 && (
                              <span className="px-1 rounded bg-emerald-500/30 text-emerald-200">
                                필기 {strokeCount}
                              </span>
                            )}
                          </div>
                        </div>
                        <span
                          className={`text-[10px] font-bold ${
                            isSelected ? 'text-sky-400' : 'text-slate-400'
                          }`}
                        >
                          {p.label}
                        </span>
                      </button>
                    );
                  })}

                  {/* 사진 속 [+ 새 페이지 추가] 아이콘 박스 */}
                  <button
                    type="button"
                    onClick={handleAddBlankPage}
                    title="빈 칠판 메모 페이지 추가"
                    className="flex flex-col items-center gap-0.5 shrink-0 cursor-pointer"
                  >
                    <div className="w-20 sm:w-24 h-12 sm:h-14 rounded border border-white/25 hover:border-white/60 bg-white/5 flex items-center justify-center text-slate-200 transition">
                      <FilePlus2 className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] text-slate-400 font-semibold">+칠판추가</span>
                  </button>
                </div>

                {/* 우측 끝: 사진 우측 하단의 ▶ 재생 버튼 (2차 호출 TASK=VIDEO) 및 + / - 줌 컨트롤 */}
                <div className="flex items-center gap-2.5 shrink-0 pl-2 border-l border-white/10">
                  {/* ▶ 상세 설명 영상 재생 버튼 (TASK=VIDEO 온디맨드 호출) */}
                  <button
                    type="button"
                    onClick={() => {
                      triggerAitHaptic('tap');
                      if (videoPayload) {
                        setIsVideoMode(true);
                        setVideoPlaying(true);
                      } else {
                        onRequestVideo();
                      }
                    }}
                    disabled={isGeneratingVideo || !solve || solve.status !== 'ok'}
                    title="상세 설명 영상 재생 (누를 때만 TASK=VIDEO 생성하여 비용 절약)"
                    className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-black text-xs shadow-lg shadow-emerald-500/20 cursor-pointer"
                  >
                    {isGeneratingVideo ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="hidden sm:inline">영상 생성 중...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-current" />
                        <span className="hidden sm:inline">판서 영상 재생</span>
                      </>
                    )}
                  </button>

                  {/* + / - 배율 버튼 (사진 우측 하단 동일 배치) */}
                  <div className="flex flex-col items-center gap-1 text-slate-300">
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(130, z + 10))}
                      className="p-1 rounded hover:bg-white/10 cursor-pointer"
                      title="칠판 확대"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(80, z - 10))}
                      className="p-1 rounded hover:bg-white/10 cursor-pointer"
                      title="칠판 축소"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ================= 전자칠판 하단 메탈 하드웨어 베젤 & 고정 고지 문구 (체크리스트 #5) ================= */}
        <div className="h-7 bg-gradient-to-b from-[#333130] to-[#22201f] border-t border-white/10 px-3 flex items-center justify-between text-[11px] text-slate-300 shrink-0">
          {/* 좌측: 브랜드 로고 */}
          <div className="font-black tracking-widest text-slate-400 text-[10px]">
            AIBOARD SMART BLACKBOARD
          </div>

          {/* 중앙: 사진 하단 베젤의 하드웨어 퀵 버튼 바 연출 */}
          <div className="hidden md:flex items-center gap-1.5 bg-black/45 px-2.5 py-0.5 rounded border border-white/15">
            {(['pen', 'highlighter', 'rect', 'arrow', 'eraser'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTool(t)}
                className={`w-4 h-4 rounded-xs flex items-center justify-center text-[9px] cursor-pointer ${
                  activeTool === t
                    ? 'bg-amber-300 text-slate-950 font-black'
                    : 'bg-white/10 text-slate-300 hover:bg-white/20'
                }`}
              >
                •
              </button>
            ))}
          </div>

          {/* 우측: 체크리스트 #5 필수 고정 문구 ("AI가 생성한 설명이에요") */}
          <div className="inline-flex items-center gap-1 font-bold text-emerald-300 text-[11px]">
            <Info className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>AI가 생성한 설명이에요</span>
            {mode === 'kid' && (
              <span className="hidden sm:inline text-amber-300 ml-1.5">
                · 유아 모드 개인정보 미저장
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
