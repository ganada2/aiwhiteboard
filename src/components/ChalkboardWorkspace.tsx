import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Circle,
  Compass,
  FilePlus2,
  Grid,
  Info,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  StickyNote,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type {
  LearnAction,
  LearnMode,
  SolveApiPayload,
  VideoApiPayload,
} from '../shared/schema';
import { triggerAitHaptic } from '../utils/aitBridge';
import {
  ChalkStickButton,
  FeltEraserButton,
  HighlighterMarkerButton,
  MemoPadButton,
  ModeThreeStageToggle,
  ShapeStencilButton,
} from './ChalkboardControls';
import { MathText } from './MathText';
import {
  TeacherOverlaySheet,
  type PinnedChalkCardInput,
} from './TeacherOverlaySheet';

export type DrawTool =
  | 'pen'
  | 'highlighter'
  | 'rect'
  | 'circle'
  | 'arrow'
  | 'eraser';

interface Point {
  x: number; // 월드 픽셀 좌표 (0 ~ WORLD_W)
  y: number; // 월드 픽셀 좌표 (0 ~ WORLD_H)
}

interface ChalkStroke {
  id: string;
  tool: DrawTool;
  color: string;
  width: number;
  points: Point[];
}

export interface ChalkMemoCard {
  id: string;
  kind: 'user_memo' | 'teacher_pin';
  title?: string;
  text: string;
  x: number; // 월드 픽셀 좌표 X
  y: number; // 월드 픽셀 좌표 Y
  color: string;
}

interface BlackboardPage {
  id: string;
  name: string;
}

interface ChalkboardWorkspaceProps {
  mode: LearnMode;
  action: LearnAction;
  onChangeMode: (m: LearnMode) => void;
  onChangeAction: (a: LearnAction) => void;
  solvePayload: SolveApiPayload | null;
  videoPayload: VideoApiPayload | null;
  isSolving: boolean;
  isGeneratingVideo: boolean;
  errorMsg: string | null;
  onExplainBoardContent: (
    content: string,
    overrideMode?: LearnMode,
    overrideAction?: LearnAction,
  ) => void;
  onRequestVideo: () => void;
  onOpenInspector: () => void;
}

const WORLD_W = 2400;
const WORLD_H = 1800;
const WORLD_ORIGIN_X = 700;
const WORLD_ORIGIN_Y = 480;

const CHALK_STICKS = [
  { name: '백묵(흰색)', value: '#F8FAFC' },
  { name: '노란분필', value: '#FDE047' },
  { name: '초록분필', value: '#6EE7B7' },
  { name: '분홍분필', value: '#FDA4AF' },
  { name: '하늘분필', value: '#7DD3FC' },
];

export const ChalkboardWorkspace: React.FC<ChalkboardWorkspaceProps> = ({
  mode,
  action,
  onChangeMode,
  onChangeAction,
  solvePayload,
  videoPayload,
  isSolving,
  isGeneratingVideo,
  errorMsg,
  onExplainBoardContent,
  onRequestVideo,
  onOpenInspector,
}) => {
  // 칠판 페이지 목록
  const [pages, setPages] = useState<BlackboardPage[]>([
    { id: 'board_1', name: '칠판 #1' },
  ]);
  const [activePageId, setActivePageId] = useState<string>('board_1');

  // 페이지별 메모 카드 및 완료된 분필 스트로크
  const [cardsByPage, setCardsByPage] = useState<Record<string, ChalkMemoCard[]>>({
    board_1: [],
  });
  const [strokesByPage, setStrokesByPage] = useState<Record<string, ChalkStroke[]>>({
    board_1: [],
  });

  // 현재 도구 및 분필 색상
  const [activeTool, setActiveTool] = useState<DrawTool>('pen');
  const [chalkColor, setChalkColor] = useState<string>('#F8FAFC');
  const [showShapeMenu, setShowShapeMenu] = useState<boolean>(false);
  const [showGrid, setShowGrid] = useState<boolean>(false);

  // 보드 시선 이동(2손가락 패닝 & 핀치 줌) 상태
  const [pan, setPan] = useState<{ x: number; y: number }>({
    x: -WORLD_ORIGIN_X,
    y: -WORLD_ORIGIN_Y,
  });
  const [scale, setScale] = useState<number>(1);
  const [isTwoFingerPanning, setIsTwoFingerPanning] = useState<boolean>(false);

  // 메모 카드 편집 및 드래그 상태
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const draggingCardRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // AI 선생님 오버레이 시트 & 빠른 질문 모달
  const [overlayOpen, setOverlayOpen] = useState<boolean>(false);
  const [quickPromptOpen, setQuickPromptOpen] = useState<boolean>(false);
  const [quickPromptText, setQuickPromptText] = useState<string>('');

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 60fps 끊김 없는 터치 드로잉을 위한 Ref 상태 (드로잉 도중 React 리렌더링 방지!)
  const activeStrokeRef = useRef<ChalkStroke | null>(null);
  const activeTouchGestureRef = useRef<{
    mode: 'none' | 'draw' | 'pan_zoom';
    lastMidX: number;
    lastMidY: number;
    lastDist: number;
  }>({
    mode: 'none',
    lastMidX: 0,
    lastMidY: 0,
    lastDist: 0,
  });

  // 최신 pan, scale, tool, color를 이벤트 리스너 내부에서 즉시 참조하기 위한 Ref
  const viewStateRef = useRef({
    pan,
    scale,
    activeTool,
    chalkColor,
    activePageId,
  });
  useEffect(() => {
    viewStateRef.current = {
      pan,
      scale,
      activeTool,
      chalkColor,
      activePageId,
    };
  }, [pan, scale, activeTool, chalkColor, activePageId]);

  const currentCards = useMemo(
    () => cardsByPage[activePageId] ?? [],
    [cardsByPage, activePageId],
  );
  const currentStrokes = useMemo(
    () => strokesByPage[activePageId] ?? [],
    [strokesByPage, activePageId],
  );
  const strokesRef = useRef<ChalkStroke[]>(currentStrokes);
  useEffect(() => {
    strokesRef.current = currentStrokes;
  }, [currentStrokes]);

  // 화면 좌표(clientX, clientY) -> 칠판 월드 좌표(0 ~ WORLD_W, 0 ~ WORLD_H) 변환
  const screenToWorld = useCallback((clientX: number, clientY: number): Point => {
    const vp = viewportRef.current;
    const { pan: curPan, scale: curScale } = viewStateRef.current;
    if (!vp) return { x: WORLD_ORIGIN_X + clientX, y: WORLD_ORIGIN_Y + clientY };
    const rect = vp.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    return {
      x: (localX - curPan.x) / curScale,
      y: (localY - curPan.y) / curScale,
    };
  }, []);

  // 단일 스트로크를 2D Context에 부드러운 곡선(quadraticCurveTo)으로 그리는 함수
  const drawStrokeOnCtx = useCallback((ctx: CanvasRenderingContext2D, st: ChalkStroke) => {
    const pts = st.points;
    if (pts.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (st.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 34;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = st.color;
      ctx.fillStyle = st.color;
      ctx.lineWidth = st.tool === 'highlighter' ? 20 : st.width;
      ctx.globalAlpha = st.tool === 'highlighter' ? 0.34 : 0.94;
      if (st.tool !== 'highlighter') {
        ctx.shadowColor = st.color;
        ctx.shadowBlur = 1.5;
      }
    }

    if (st.tool === 'rect' && pts.length >= 2) {
      const p0 = pts[0];
      const p1 = pts[pts.length - 1];
      ctx.setLineDash([10, 7]);
      ctx.lineWidth = 3.5;
      ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      ctx.restore();
      return;
    }

    if (st.tool === 'circle' && pts.length >= 2) {
      const p0 = pts[0];
      const p1 = pts[pts.length - 1];
      const cx = (p0.x + p1.x) / 2;
      const cy = (p0.y + p1.y) / 2;
      const rx = Math.abs(p1.x - p0.x) / 2;
      const ry = Math.abs(p1.y - p0.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(4, rx), Math.max(4, ry), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (st.tool === 'arrow' && pts.length >= 2) {
      const p0 = pts[0];
      const p1 = pts[pts.length - 1];
      ctx.setLineDash([10, 7]);
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();

      ctx.setLineDash([]);
      const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const headLen = 15;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(
        p1.x - headLen * Math.cos(angle - Math.PI / 6),
        p1.y - headLen * Math.sin(angle - Math.PI / 6),
      );
      ctx.lineTo(
        p1.x - headLen * Math.cos(angle + Math.PI / 6),
        p1.y - headLen * Math.sin(angle + Math.PI / 6),
      );
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      return;
    }

    // 점 1개만 찍혔을 때도 분필 점이 보이도록 처리
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, (st.width || 4) / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // 2개 이상의 점은 Quadratic Bézier 곡선 보간으로 끊김 없이 매끄럽게 연결!
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2;
      const midY = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    ctx.restore();
  }, []);

  // 전체 캔버스 다시 그리기
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, WORLD_W, WORLD_H);
    for (const st of strokesRef.current) {
      drawStrokeOnCtx(ctx, st);
    }
    if (activeStrokeRef.current) {
      drawStrokeOnCtx(ctx, activeStrokeRef.current);
    }
  }, [drawStrokeOnCtx]);

  // 캔버스 해상도 최초 1회 초기화 및 스트로크 변경 시 재렌더링
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== WORLD_W || canvas.height !== WORLD_H) {
      canvas.width = WORLD_W;
      canvas.height = WORLD_H;
    }
    redrawCanvas();
  }, [currentStrokes, activePageId, redrawCanvas]);

  // ================= 모바일 네이티브 멀티터치 (1손가락 끊김없는 필기 + 2손가락 시선이동/핀치줌) =================
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getTouchDist = (t1: Touch, t2: Touch) =>
      Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      setShowShapeMenu(false);

      // 두 손가락 이상 터치 시 -> 즉시 시선 이동(Pan & Pinch Zoom) 모드로 전환!
      if (e.touches.length >= 2) {
        // 방금 1손가락으로 찍히기 시작한 짧은 점은 취소
        if (activeStrokeRef.current && activeStrokeRef.current.points.length < 5) {
          activeStrokeRef.current = null;
          redrawCanvas();
        }
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        activeTouchGestureRef.current = {
          mode: 'pan_zoom',
          lastMidX: (t1.clientX + t2.clientX) / 2,
          lastMidY: (t1.clientY + t2.clientY) / 2,
          lastDist: getTouchDist(t1, t2),
        };
        setIsTwoFingerPanning(true);
        return;
      }

      // 한 손가락 터치 시 -> 분필 드로잉 시작
      if (e.touches.length === 1 && activeTouchGestureRef.current.mode !== 'pan_zoom') {
        const t = e.touches[0];
        const pt = screenToWorld(t.clientX, t.clientY);
        const { activeTool: tool, chalkColor: color } = viewStateRef.current;

        activeTouchGestureRef.current.mode = 'draw';
        activeStrokeRef.current = {
          id: `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          tool,
          color,
          width: 4.2,
          points: [pt],
        };
        redrawCanvas();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();

      // 2손가락 시선 이동 및 확대/축소 처리
      if (e.touches.length >= 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;
        const dist = getTouchDist(t1, t2);

        if (activeTouchGestureRef.current.mode !== 'pan_zoom') {
          activeTouchGestureRef.current = {
            mode: 'pan_zoom',
            lastMidX: midX,
            lastMidY: midY,
            lastDist: dist,
          };
          setIsTwoFingerPanning(true);
          return;
        }

        const dx = midX - activeTouchGestureRef.current.lastMidX;
        const dy = midY - activeTouchGestureRef.current.lastMidY;
        const prevDist = activeTouchGestureRef.current.lastDist;

        activeTouchGestureRef.current.lastMidX = midX;
        activeTouchGestureRef.current.lastMidY = midY;
        activeTouchGestureRef.current.lastDist = dist;

        setPan((prev) => ({
          x: Math.min(200, Math.max(-WORLD_W + 300, prev.x + dx)),
          y: Math.min(200, Math.max(-WORLD_H + 300, prev.y + dy)),
        }));

        if (prevDist > 20 && dist > 20) {
          const ratio = dist / prevDist;
          setScale((prev) => Math.min(2.0, Math.max(0.55, prev * ratio)));
        }
        return;
      }

      // 1손가락 연속 분필 드로잉 처리 (React 리렌더링 없이 캔버스에 즉시 그림!)
      if (
        e.touches.length === 1 &&
        activeTouchGestureRef.current.mode === 'draw' &&
        activeStrokeRef.current
      ) {
        const t = e.touches[0];
        const pt = screenToWorld(t.clientX, t.clientY);
        const cur = activeStrokeRef.current;

        if (cur.tool === 'rect' || cur.tool === 'circle' || cur.tool === 'arrow') {
          cur.points = [cur.points[0], pt];
        } else {
          cur.points.push(pt);
        }
        redrawCanvas();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 0) {
        if (activeStrokeRef.current && activeStrokeRef.current.points.length > 0) {
          const finished = activeStrokeRef.current;
          const pageId = viewStateRef.current.activePageId;
          activeStrokeRef.current = null;
          setStrokesByPage((prev) => ({
            ...prev,
            [pageId]: [...(prev[pageId] ?? []), finished],
          }));
        }
        activeTouchGestureRef.current.mode = 'none';
        setIsTwoFingerPanning(false);
      }
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [redrawCanvas, screenToWorld]);

  // PC 마우스 드로잉 및 휠/우클릭 시선 이동 지원
  const isMouseDrawingRef = useRef<boolean>(false);
  const isMousePanningRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  });

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // 마우스 휠 클릭 또는 우클릭 시 시선 이동
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      isMousePanningRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
      setIsTwoFingerPanning(true);
      return;
    }
    if (e.button !== 0) return;
    setShowShapeMenu(false);

    const pt = screenToWorld(e.clientX, e.clientY);
    isMouseDrawingRef.current = true;
    activeStrokeRef.current = {
      id: `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      tool: activeTool,
      color: chalkColor,
      width: 4.2,
      points: [pt],
    };
    redrawCanvas();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isMousePanningRef.current.active) {
      const dx = e.clientX - isMousePanningRef.current.lastX;
      const dy = e.clientY - isMousePanningRef.current.lastY;
      isMousePanningRef.current.lastX = e.clientX;
      isMousePanningRef.current.lastY = e.clientY;
      setPan((prev) => ({
        x: Math.min(200, Math.max(-WORLD_W + 300, prev.x + dx)),
        y: Math.min(200, Math.max(-WORLD_H + 300, prev.y + dy)),
      }));
      return;
    }

    if (!isMouseDrawingRef.current || !activeStrokeRef.current) return;
    const pt = screenToWorld(e.clientX, e.clientY);
    const cur = activeStrokeRef.current;
    if (cur.tool === 'rect' || cur.tool === 'circle' || cur.tool === 'arrow') {
      cur.points = [cur.points[0], pt];
    } else {
      cur.points.push(pt);
    }
    redrawCanvas();
  };

  const handleMouseUp = () => {
    if (isMousePanningRef.current.active) {
      isMousePanningRef.current.active = false;
      setIsTwoFingerPanning(false);
    }
    if (isMouseDrawingRef.current && activeStrokeRef.current) {
      const finished = activeStrokeRef.current;
      activeStrokeRef.current = null;
      isMouseDrawingRef.current = false;
      setStrokesByPage((prev) => ({
        ...prev,
        [activePageId]: [...(prev[activePageId] ?? []), finished],
      }));
    }
  };

  // 칠판 위 메모 텍스트 합산
  const combinedMemoText = useMemo(() => {
    const userMemos = currentCards
      .filter((c) => c.kind === 'user_memo' && c.text.trim().length > 0)
      .map((c) => c.text.trim());
    if (userMemos.length > 0) return userMemos.join(' / ');
    return currentCards
      .filter((c) => c.text.trim().length > 0)
      .map((c) => c.text.trim())
      .join(' / ');
  }, [currentCards]);

  // 현재 시선(뷰포트) 중앙에 새 메모 카드 추가
  const handleAddMemoCard = (initialText = '', worldPos?: Point) => {
    triggerAitHaptic('tap');
    const vp = viewportRef.current;
    const vpW = vp ? vp.clientWidth : 380;
    const vpH = vp ? vp.clientHeight : 640;

    const count = currentCards.length;
    const centerWorld = screenToWorld(
      vpW * 0.18 + (count % 3) * 36,
      vpH * 0.22 + (count % 4) * 42,
    );

    const newCard: ChalkMemoCard = {
      id: `memo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      kind: 'user_memo',
      text: initialText,
      x: worldPos?.x ?? centerWorld.x,
      y: worldPos?.y ?? centerWorld.y,
      color: chalkColor,
    };

    setCardsByPage((prev) => ({
      ...prev,
      [activePageId]: [...(prev[activePageId] ?? []), newCard],
    }));
    setEditingCardId(newCard.id);
  };

  // 선생님 오버레이에서 [📌 칠판에 붙이기]
  const handlePinFromTeacher = (cardInput: PinnedChalkCardInput) => {
    const vp = viewportRef.current;
    const vpW = vp ? vp.clientWidth : 380;
    const vpH = vp ? vp.clientHeight : 640;
    const existingCount = (cardsByPage[activePageId] ?? []).length;
    const targetWorld = screenToWorld(
      vpW * 0.22 + (existingCount % 3) * 32,
      vpH * 0.24 + (existingCount % 4) * 38,
    );

    const pinnedCard: ChalkMemoCard = {
      id: `pin_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      kind: 'teacher_pin',
      title: cardInput.title,
      text: cardInput.lines.join('\n'),
      x: targetWorld.x,
      y: targetWorld.y,
      color: cardInput.accentColor,
    };
    setCardsByPage((prev) => ({
      ...prev,
      [activePageId]: [...(prev[activePageId] ?? []), pinnedCard],
    }));
  };

  const handlePinAllFromTeacher = (cards: PinnedChalkCardInput[]) => {
    const vp = viewportRef.current;
    const vpW = vp ? vp.clientWidth : 380;
    const baseWorld = screenToWorld(vpW * 0.12, 130);

    const newPinned: ChalkMemoCard[] = cards.map((c, idx) => ({
      id: `pin_${Date.now()}_${idx}`,
      kind: 'teacher_pin',
      title: c.title,
      text: c.lines.join('\n'),
      x: baseWorld.x + (idx % 2) * 290,
      y: baseWorld.y + Math.floor(idx / 2) * 175,
      color: c.accentColor,
    }));
    setCardsByPage((prev) => ({
      ...prev,
      [activePageId]: [...(prev[activePageId] ?? []), ...newPinned],
    }));
    setOverlayOpen(false);
  };

  // 메모 카드 헤더 드래그 이동 (Pointer Events)
  const handleCardPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    card: ChalkMemoCard,
  ) => {
    e.stopPropagation();
    draggingCardRef.current = {
      id: card.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: card.x,
      origY: card.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleCardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = draggingCardRef.current;
    if (!drag) return;
    e.stopPropagation();
    const dx = (e.clientX - drag.startClientX) / scale;
    const dy = (e.clientY - drag.startClientY) / scale;

    setCardsByPage((prev) => ({
      ...prev,
      [activePageId]: (prev[activePageId] ?? []).map((c) =>
        c.id === drag.id
          ? {
              ...c,
              x: Math.max(40, Math.min(WORLD_W - 300, drag.origX + dx)),
              y: Math.max(40, Math.min(WORLD_H - 200, drag.origY + dy)),
            }
          : c,
      ),
    }));
  };

  const handleCardPointerUp = () => {
    draggingCardRef.current = null;
  };

  const handleResetCamera = () => {
    triggerAitHaptic('tap');
    setPan({ x: -WORLD_ORIGIN_X, y: -WORLD_ORIGIN_Y });
    setScale(1);
  };

  const handleUndoStroke = () => {
    triggerAitHaptic('tap');
    setStrokesByPage((prev) => {
      const list = prev[activePageId] ?? [];
      if (list.length === 0) return prev;
      return { ...prev, [activePageId]: list.slice(0, -1) };
    });
  };

  const handleClearBoard = () => {
    triggerAitHaptic('warning');
    setStrokesByPage((prev) => ({ ...prev, [activePageId]: [] }));
    setCardsByPage((prev) => ({ ...prev, [activePageId]: [] }));
  };

  const handleAddNewPage = () => {
    triggerAitHaptic('tap');
    const nextNum = pages.length + 1;
    const newId = `board_${Date.now()}`;
    setPages((prev) => [...prev, { id: newId, name: `칠판 #${nextNum}` }]);
    setCardsByPage((prev) => ({ ...prev, [newId]: [] }));
    setStrokesByPage((prev) => ({ ...prev, [newId]: [] }));
    setActivePageId(newId);
    handleResetCamera();
  };

  const handleTriggerExplain = () => {
    triggerAitHaptic('tap');
    if (combinedMemoText.trim().length > 0) {
      setOverlayOpen(true);
      onExplainBoardContent(combinedMemoText.trim());
    } else {
      setQuickPromptOpen(true);
    }
  };

  const isBoardCompletelyEmpty =
    currentCards.length === 0 && currentStrokes.length === 0;

  return (
    <div
      className="relative h-dvh w-screen overflow-hidden flex flex-col select-none bg-[#171d1b]"
      style={{ touchAction: 'none' }}
    >
      {/* ================= 전체화면 칠판 뷰포트 ================= */}
      <div
        ref={viewportRef}
        onContextMenu={(e) => e.preventDefault()}
        className="relative flex-1 w-full overflow-hidden"
        style={{ touchAction: 'none' }}
      >
        {/* ================= 2400x1800 대형 칠판 월드 (2손가락 시선 이동 & 핀치 줌 적용) ================= */}
        <div
          style={{
            width: `${WORLD_W}px`,
            height: `${WORLD_H}px`,
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
            transformOrigin: '0 0',
            backgroundColor: '#222826',
            backgroundImage: [
              'radial-gradient(ellipse at 48% 44%, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.05) 42%, rgba(0,0,0,0.36) 100%)',
              'radial-gradient(ellipse at 25% 65%, rgba(255,255,255,0.09) 0%, transparent 50%)',
              'radial-gradient(ellipse at 75% 30%, rgba(255,255,255,0.08) 0%, transparent 48%)',
              'repeating-linear-gradient(-11deg, rgba(255,255,255,0.022) 0px, rgba(255,255,255,0.022) 2px, transparent 2px, transparent 16px)',
            ].join(', '),
          }}
          className="absolute top-0 left-0 will-change-transform"
        >
          {/* 모눈 격자 보조선 */}
          {showGrid && (
            <div
              className="absolute inset-0 pointer-events-none opacity-20"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgba(255,255,255,0.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.25) 1px, transparent 1px)',
                backgroundSize: '40px 40px',
              }}
            />
          )}

          {/* 분필 드로잉 캔버스 (1손가락 연속 드로잉 & 2손가락 시선 이동) */}
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ touchAction: 'none' }}
            className="absolute inset-0 w-full h-full z-10 cursor-crosshair"
          />

          {/* 칠판 위 메모 카드 레이어 */}
          <div className="absolute inset-0 z-20 pointer-events-none">
            {currentCards.map((card) => {
              const isEditing = editingCardId === card.id;
              const isTeacherPin = card.kind === 'teacher_pin';

              return (
                <div
                  key={card.id}
                  style={{
                    left: `${card.x}px`,
                    top: `${card.y}px`,
                    borderColor: card.color,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingCardId(card.id);
                  }}
                  className={`absolute w-68 sm:w-76 rounded-2xl border-2 ${
                    isTeacherPin
                      ? 'border-solid bg-[#0e261c]/95'
                      : 'border-dashed bg-black/60'
                  } backdrop-blur-xs shadow-[0_12px_30px_rgba(0,0,0,0.65)] pointer-events-auto transition-shadow ${
                    isEditing ? 'ring-2 ring-amber-300' : ''
                  }`}
                >
                  {/* 카드 상단 드래그 핸들 바 */}
                  <div
                    onPointerDown={(e) => handleCardPointerDown(e, card)}
                    onPointerMove={handleCardPointerMove}
                    onPointerUp={handleCardPointerUp}
                    onPointerCancel={handleCardPointerUp}
                    style={{ touchAction: 'none' }}
                    className="flex items-center justify-between px-3 py-2 border-b border-white/15 cursor-grab active:cursor-grabbing bg-white/5 rounded-t-2xl"
                  >
                    <span
                      style={{ color: card.color }}
                      className="text-xs font-extrabold truncate"
                    >
                      {isTeacherPin
                        ? `📌 ${card.title || '선생님 판서 노트'}`
                        : '📝 칠판 메모 (끌어서 이동)'}
                    </span>

                    <div className="flex items-center gap-1.5">
                      {card.text.trim().length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            triggerAitHaptic('tap');
                            setOverlayOpen(true);
                            onExplainBoardContent(card.text.trim());
                          }}
                          className="px-2 py-0.5 rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 text-slate-950 text-[10px] font-black shadow cursor-pointer"
                        >
                          ✨설명
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCardsByPage((prev) => ({
                            ...prev,
                            [activePageId]: (prev[activePageId] ?? []).filter(
                              (c) => c.id !== card.id,
                            ),
                          }));
                        }}
                        className="p-1 rounded-full hover:bg-rose-500/30 text-slate-300 hover:text-rose-200 cursor-pointer"
                        title="메모 삭제"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* 카드 본문 */}
                  <div className="p-3.5 space-y-2">
                    {isEditing ? (
                      <textarea
                        autoFocus
                        rows={3}
                        value={card.text}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCardsByPage((prev) => ({
                            ...prev,
                            [activePageId]: (prev[activePageId] ?? []).map((c) =>
                              c.id === card.id ? { ...c, text: val } : c,
                            ),
                          }));
                        }}
                        placeholder="수식이나 개념 메모를 적어보세요 (예: x^2 - 5x + 6 = 0)"
                        className="w-full bg-transparent text-white font-bold text-sm sm:text-base focus:outline-none resize-none placeholder:text-slate-400"
                      />
                    ) : (
                      <div
                        onClick={() => setEditingCardId(card.id)}
                        className="min-h-[2.5rem] text-sm sm:text-base font-bold text-white whitespace-pre-wrap leading-relaxed cursor-text"
                      >
                        {card.text ? (
                          card.text.split('\n').map((line, idx) => (
                            <div key={idx}>
                              <MathText text={line} />
                            </div>
                          ))
                        ) : (
                          <span className="text-slate-400 text-xs">
                            여기를 터치해 메모를 입력하세요...
                          </span>
                        )}
                      </div>
                    )}

                    {isEditing && (
                      <div className="pt-1.5 border-t border-white/10 flex items-center justify-between gap-2">
                        <div className="text-xs text-amber-200 truncate">
                          {card.text.trim() ? <MathText text={card.text} /> : '수식 자동 변환 지원'}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingCardId(null);
                          }}
                          className="px-2.5 py-1 rounded-full bg-amber-300 text-slate-950 text-[11px] font-black shrink-0 cursor-pointer"
                        >
                          완료
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ================= 1. 상단 플로팅 바 (칠판 탭 + 3단계 슬라이딩 토글 스위치) ================= */}
        <header className="absolute top-3 inset-x-3 z-30 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          {/* 좌측: 칠판 페이지 캡슐 */}
          <div className="flex items-center gap-1 bg-[#111715]/90 backdrop-blur-md border border-white/15 rounded-full p-1 shadow-[0_6px_20px_rgba(0,0,0,0.6)] pointer-events-auto overflow-x-auto max-w-[52vw] sm:max-w-none">
            {pages.map((p) => {
              const active = p.id === activePageId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    triggerAitHaptic('tap');
                    setActivePageId(p.id);
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-black transition shrink-0 cursor-pointer ${
                    active
                      ? 'bg-gradient-to-b from-white to-slate-200 text-slate-950 shadow'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {p.name}
                </button>
              );
            })}

            <button
              type="button"
              onClick={handleAddNewPage}
              title="새 칠판 추가"
              className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-emerald-300 flex items-center justify-center shrink-0 cursor-pointer"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 우측: 3단계 슬라이딩 토글 스위치 (유아 · 고등 · 성인) + 격자/초기화 원형 버튼 */}
          <div className="flex items-center gap-1.5 pointer-events-auto">
            <ModeThreeStageToggle mode={mode} onChange={onChangeMode} />

            <button
              type="button"
              onClick={() => setShowGrid((g) => !g)}
              title="모눈 보조선"
              className={`w-9 h-9 rounded-full border flex items-center justify-center shadow-lg transition cursor-pointer ${
                showGrid
                  ? 'bg-emerald-500/30 border-emerald-400 text-emerald-200'
                  : 'bg-[#111715]/90 border-white/15 text-slate-300 hover:text-white'
              }`}
            >
              <Grid className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleClearBoard}
              title="칠판 전체 지우기"
              className="w-9 h-9 rounded-full bg-[#111715]/90 border border-white/15 text-rose-300 hover:bg-rose-500/20 flex items-center justify-center shadow-lg cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* 두 손가락 시선 이동 안내 및 카메라 원위치 알약 */}
        {(isTwoFingerPanning ||
          Math.abs(pan.x + WORLD_ORIGIN_X) > 25 ||
          Math.abs(pan.y + WORLD_ORIGIN_Y) > 25 ||
          Math.abs(scale - 1) > 0.05) && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-950/85 border border-emerald-400/40 text-xs text-emerald-200 shadow-xl pointer-events-auto">
            <Compass className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              시선 배율 <strong>{Math.round(scale * 100)}%</strong>
            </span>
            <button
              type="button"
              onClick={handleResetCamera}
              className="ml-1 px-2 py-0.5 rounded-full bg-emerald-500/25 hover:bg-emerald-500/40 text-white font-bold flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" /> 중앙 복귀
            </button>
          </div>
        )}

        {/* ================= 2. 빈 칠판 시작 안내 카드 ================= */}
        {isBoardCompletelyEmpty && (
          <div className="absolute inset-0 z-15 flex flex-col items-center justify-center p-5 text-center pointer-events-none">
            <div className="max-w-sm rounded-3xl border-2 border-dashed border-white/20 bg-black/30 backdrop-blur-[2px] p-5 sm:p-6 space-y-3.5 pointer-events-auto">
              <div className="w-11 h-11 rounded-2xl bg-amber-300/20 border border-amber-300/40 text-amber-200 flex items-center justify-center mx-auto">
                <StickyNote className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base sm:text-lg font-black text-white">
                  한 손가락으로 분필 필기 · 두 손가락으로 시선 이동!
                </h2>
                <p className="text-xs text-slate-300 leading-relaxed">
                  칠판에 손가락으로 자유롭게 필기하거나 <strong>[+메모]</strong> 카드를 올린 뒤,
                  하단 <strong>[✨ AI 설명하기]</strong>를 눌러보세요.
                </p>
              </div>

              <div className="flex flex-wrap justify-center gap-1.5 pt-1">
                {[
                  { label: '📝 x² - 5x + 6 = 0', text: 'x^2 - 5x + 6 = 0' },
                  { label: '📐 피타고라스 정리', text: '피타고라스 정리' },
                  { label: '💰 복리와 72법칙', text: '복리 계산과 72의 법칙' },
                ].map((sample) => (
                  <button
                    key={sample.label}
                    type="button"
                    onClick={() => handleAddMemoCard(sample.text)}
                    className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs font-bold text-amber-200 border border-white/15 cursor-pointer"
                  >
                    {sample.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ================= 3. 하단 입체 분필 받침대 독 (3D 분필·지우개·메모 + AI 설명 캡슐) ================= */}
        <div className="absolute bottom-9 inset-x-2.5 z-30 flex flex-col items-center gap-2 pointer-events-none">
          {/* 도형 스텐실 서브 팝오버 */}
          {showShapeMenu && (
            <div className="bg-[#111715]/95 backdrop-blur-md border border-sky-400/40 rounded-full px-3 py-1.5 shadow-2xl flex items-center gap-1.5 pointer-events-auto animate-fadeIn">
              <button
                type="button"
                onClick={() => {
                  setActiveTool('rect');
                  setShowShapeMenu(false);
                }}
                className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 cursor-pointer ${
                  activeTool === 'rect'
                    ? 'bg-sky-400 text-slate-950'
                    : 'bg-white/10 text-white'
                }`}
              >
                <Square className="w-3.5 h-3.5" /> 점선네모
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTool('circle');
                  setShowShapeMenu(false);
                }}
                className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 cursor-pointer ${
                  activeTool === 'circle'
                    ? 'bg-sky-400 text-slate-950'
                    : 'bg-white/10 text-white'
                }`}
              >
                <Circle className="w-3.5 h-3.5" /> 동그라미
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTool('arrow');
                  setShowShapeMenu(false);
                }}
                className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 cursor-pointer ${
                  activeTool === 'arrow'
                    ? 'bg-sky-400 text-slate-950'
                    : 'bg-white/10 text-white'
                }`}
              >
                <ArrowUpRight className="w-3.5 h-3.5" /> 점선화살표
              </button>
            </div>
          )}

          {/* 메인 입체 칠판 분필 트레이 독 */}
          <div className="w-full max-w-2xl rounded-3xl bg-gradient-to-b from-[#232b28]/95 to-[#121715]/98 backdrop-blur-md border-t border-white/20 border-b-4 border-b-[#5c3a1e] px-2.5 sm:px-4 py-1.5 shadow-[0_14px_34px_rgba(0,0,0,0.85)] flex items-center justify-between gap-2 pointer-events-auto">
            {/* 좌측: +메모장 버튼 & 5색 입체 분필 스틱 + 형광펜 + 도형자 + 나무 칠판지우개 */}
            <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
              {/* 입체 포스트잇 +메모 버튼 */}
              <MemoPadButton onClick={() => handleAddMemoCard('')} />

              <div className="w-px h-7 bg-white/15 mx-0.5 shrink-0" />

              {/* 5색 실제 분필 스틱 버튼들 */}
              {CHALK_STICKS.map((c) => (
                <ChalkStickButton
                  key={c.value}
                  color={c.value}
                  name={c.name}
                  active={activeTool === 'pen' && chalkColor === c.value}
                  onClick={() => {
                    triggerAitHaptic('tap');
                    setChalkColor(c.value);
                    setActiveTool('pen');
                  }}
                />
              ))}

              {/* 입체 형광 마커 */}
              <HighlighterMarkerButton
                active={activeTool === 'highlighter'}
                onClick={() => {
                  triggerAitHaptic('tap');
                  setActiveTool('highlighter');
                }}
              />

              {/* 입체 삼각자 도형 스텐실 */}
              <ShapeStencilButton
                active={
                  activeTool === 'rect' ||
                  activeTool === 'circle' ||
                  activeTool === 'arrow'
                }
                onClick={() => {
                  triggerAitHaptic('tap');
                  setShowShapeMenu((s) => !s);
                }}
              />

              {/* 실제 나무 칠판 지우개 */}
              <FeltEraserButton
                active={activeTool === 'eraser'}
                onClick={() => {
                  triggerAitHaptic('tap');
                  setActiveTool('eraser');
                }}
              />

              {/* 되돌리기 원형 3D 버튼 */}
              <button
                type="button"
                onClick={handleUndoStroke}
                title="방금 그린 선 되돌리기"
                className="w-9 h-9 rounded-full bg-gradient-to-b from-slate-700 to-slate-800 border border-white/20 text-slate-200 hover:text-white flex items-center justify-center shadow active:translate-y-0.5 shrink-0 cursor-pointer"
              >
                <Undo2 className="w-4 h-4" />
              </button>
            </div>

            {/* 우측: 3D 입체 캡슐 [✨ AI 설명하기] 버튼 */}
            <div className="flex items-center gap-1.5 shrink-0">
              {solvePayload && !overlayOpen && (
                <button
                  type="button"
                  onClick={() => setOverlayOpen(true)}
                  title="이전 AI 선생님 설명 보드 열기"
                  className="w-9 h-9 rounded-full bg-gradient-to-b from-emerald-800 to-emerald-950 border border-emerald-400/50 text-emerald-200 flex items-center justify-center shadow cursor-pointer"
                >
                  <BookOpen className="w-4 h-4" />
                </button>
              )}

              <button
                type="button"
                onClick={handleTriggerExplain}
                disabled={isSolving}
                className="relative inline-flex items-center gap-1.5 px-4 sm:px-5 py-2.5 rounded-full bg-gradient-to-b from-emerald-300 via-emerald-400 to-teal-500 hover:from-emerald-200 hover:to-teal-400 text-slate-950 font-black text-xs sm:text-sm shadow-[0_6px_20px_rgba(16,185,129,0.5),inset_0_2px_2px_rgba(255,255,255,0.85)] border border-emerald-200 active:translate-y-0.5 transition cursor-pointer"
              >
                {isSolving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>풀이 중...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 fill-slate-950/20" />
                    <span>AI 설명하기</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ================= 텍스트 메모가 없을 때 뜨는 1줄 질문 확인 모달 ================= */}
      {quickPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl border-2 border-emerald-400/50 bg-[#142920] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-300 font-extrabold text-sm">
                <Sparkles className="w-4 h-4" />
                <span>칠판에 어떤 설명을 만들어 드릴까요?</span>
              </div>
              <button
                type="button"
                onClick={() => setQuickPromptOpen(false)}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              필기하신 문제나 궁금한 개념을 한 줄로 적어주시면 칠판 메모 생성과 함께 선생님의
              단계별 판서 설명이 올라옵니다.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!quickPromptText.trim()) return;
                const q = quickPromptText.trim();
                handleAddMemoCard(q);
                setEditingCardId(null);
                setQuickPromptOpen(false);
                setQuickPromptText('');
                setOverlayOpen(true);
                onExplainBoardContent(q);
              }}
              className="space-y-3"
            >
              <input
                type="text"
                autoFocus
                value={quickPromptText}
                onChange={(e) => setQuickPromptText(e.target.value)}
                placeholder="예: x^2 - 5x + 6 = 0, 피타고라스 정리, 복리 계산"
                className="w-full rounded-xl bg-black/50 border border-white/25 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-400"
              />

              <div className="flex flex-wrap gap-1.5">
                {[
                  'x^2 - 5x + 6 = 0',
                  '피타고라스 정리',
                  '복리 계산과 72의 법칙',
                  '1 + 1 = ?',
                ].map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setQuickPromptText(ex)}
                    className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-xs text-amber-200 cursor-pointer"
                  >
                    {ex}
                  </button>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setQuickPromptOpen(false)}
                  className="px-3.5 py-2 rounded-full bg-white/10 text-xs font-bold text-slate-300 cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-full bg-gradient-to-b from-emerald-300 to-teal-400 text-slate-950 font-black text-xs cursor-pointer"
                >
                  칠판에 적고 AI 설명 보기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= 슬라이드업 / 오버레이 AI 선생님 칠판 보드 ================= */}
      <TeacherOverlaySheet
        isOpen={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        mode={mode}
        action={action}
        onChangeMode={(nextMode) => {
          onChangeMode(nextMode);
          if (combinedMemoText.trim()) {
            onExplainBoardContent(combinedMemoText.trim(), nextMode, action);
          }
        }}
        onChangeAction={(nextAction) => {
          onChangeAction(nextAction);
          if (combinedMemoText.trim()) {
            onExplainBoardContent(combinedMemoText.trim(), mode, nextAction);
          }
        }}
        solvePayload={solvePayload}
        videoPayload={videoPayload}
        isSolving={isSolving}
        isGeneratingVideo={isGeneratingVideo}
        errorMsg={errorMsg}
        onRequestVideo={onRequestVideo}
        onRetryWithQuestion={(refinedQ) => {
          handleAddMemoCard(refinedQ);
          setEditingCardId(null);
          onExplainBoardContent(refinedQ);
        }}
        onPinToBoard={handlePinFromTeacher}
        onPinAllStepsToBoard={handlePinAllFromTeacher}
        onOpenInspector={onOpenInspector}
      />

      {/* ================= 하단 고정 AI 생성 안내 문구 (체크리스트 #5) ================= */}
      <footer className="h-7 bg-slate-950 border-t border-white/10 px-3 flex items-center justify-between text-[11px] text-slate-400 z-30 shrink-0">
        <div className="inline-flex items-center gap-1 font-bold text-emerald-300">
          <Info className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>AI가 생성한 설명이에요</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span>🤏 두 손가락: 시선 이동·확대</span>
          {mode === 'kid' && (
            <span className="text-amber-300 font-semibold">
              · 유아 모드 개인정보 미저장
            </span>
          )}
        </div>
      </footer>
    </div>
  );
};
