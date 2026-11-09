import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Code2,
  HelpCircle,
  Loader2,
  Pin,
  PlayCircle,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  LearnAction,
  LearnMode,
  SolveApiPayload,
  SolveStep,
  VideoApiPayload,
} from '../shared/schema';
import { shareChalkboardSummary, triggerAitHaptic } from '../utils/aitBridge';
import { ModeThreeStageToggle } from './ChalkboardControls';
import { MathText } from './MathText';
import { VideoChalkboardPlayer } from './VideoChalkboardPlayer';

export interface PinnedChalkCardInput {
  title: string;
  lines: string[];
  accentColor: string;
}

interface TeacherOverlaySheetProps {
  isOpen: boolean;
  onClose: () => void;
  mode: LearnMode;
  action: LearnAction;
  onChangeMode: (m: LearnMode) => void;
  onChangeAction: (a: LearnAction) => void;
  solvePayload: SolveApiPayload | null;
  videoPayload: VideoApiPayload | null;
  isSolving: boolean;
  isGeneratingVideo: boolean;
  errorMsg: string | null;
  onRequestVideo: () => void;
  onRetryWithQuestion: (q: string) => void;
  onPinToBoard: (card: PinnedChalkCardInput) => void;
  onPinAllStepsToBoard: (cards: PinnedChalkCardInput[]) => void;
  onOpenInspector: () => void;
}

export const TeacherOverlaySheet: React.FC<TeacherOverlaySheetProps> = ({
  isOpen,
  onClose,
  mode,
  action,
  onChangeMode,
  onChangeAction,
  solvePayload,
  videoPayload,
  isSolving,
  isGeneratingVideo,
  errorMsg,
  onRequestVideo,
  onRetryWithQuestion,
  onPinToBoard,
  onPinAllStepsToBoard,
  onOpenInspector,
}) => {
  const [pinnedIds, setPinnedIds] = useState<Record<string, boolean>>({});
  const [clarifyInput, setClarifyInput] = useState('');
  const [checkAnswerInput, setCheckAnswerInput] = useState('');
  const [showCheckAnswer, setShowCheckAnswer] = useState(false);
  const [sharedToast, setSharedToast] = useState(false);

  if (!isOpen) return null;

  const solve = solvePayload?.solve ?? null;
  const meta = solvePayload?.meta ?? null;

  const markPinned = (key: string) => {
    triggerAitHaptic('success');
    setPinnedIds((prev) => ({ ...prev, [key]: true }));
    window.setTimeout(() => {
      setPinnedIds((prev) => ({ ...prev, [key]: false }));
    }, 1800);
  };

  const handlePinSingleStep = (step: SolveStep) => {
    onPinToBoard({
      title: `Step ${step.no}. ${step.title}`,
      lines: [...step.board, `💡 ${step.explain}`],
      accentColor: '#FDE047',
    });
    markPinned(`step_${step.no}`);
  };

  const handlePinFinalAnswer = () => {
    if (!solve) return;
    onPinToBoard({
      title: `✅ 최종 정답 (${solve.topic})`,
      lines: [
        solve.answer,
        ...(solve.common_mistake ? [`⚠️ 주의: ${solve.common_mistake}`] : []),
      ],
      accentColor: '#6EE7B7',
    });
    markPinned('final_answer');
  };

  const handlePinEntireSolution = () => {
    if (!solve) return;
    const cards: PinnedChalkCardInput[] = solve.steps.map((st) => ({
      title: `Step ${st.no}. ${st.title}`,
      lines: [...st.board, `💡 ${st.explain}`],
      accentColor: '#FDE047',
    }));
    cards.push({
      title: `✅ 최종 정답 (${solve.topic})`,
      lines: [solve.answer],
      accentColor: '#6EE7B7',
    });
    onPinAllStepsToBoard(cards);
    markPinned('all_steps');
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60 backdrop-blur-xs animate-fadeIn">
      {/* 배경 클릭 시 닫기 */}
      <div className="flex-1" onClick={onClose} />

      {/* 슬라이드업 칠판 보드 시트 */}
      <div
        className="relative max-h-[86dvh] w-full max-w-3xl mx-auto rounded-t-3xl border-t-4 border-x-2 border-[#6b4423] shadow-[0_-20px_50px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden"
        style={{
          backgroundColor: '#132a20',
          backgroundImage:
            'radial-gradient(ellipse at 50% 20%, rgba(255,255,255,0.08) 0%, rgba(0,0,0,0.35) 100%)',
        }}
      >
        {/* 상단 드래그 핸들 & 헤더 바 */}
        <div className="px-4 sm:px-6 pt-3 pb-3 bg-black/35 border-b border-white/15 flex flex-col gap-2.5 shrink-0">
          <div
            onClick={onClose}
            className="w-12 h-1.5 rounded-full bg-white/25 mx-auto cursor-pointer hover:bg-white/40"
          />

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/25 border border-emerald-400/40 text-emerald-200 text-xs font-extrabold shrink-0">
                <Sparkles className="w-3.5 h-3.5" />
                AI 선생님 칠판 풀이
              </span>
              {solve && (
                <h2 className="text-sm sm:text-base font-extrabold text-white truncate">
                  <MathText text={solve.topic} />
                </h2>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {solve && solve.status === 'ok' && (
                <button
                  type="button"
                  onClick={handlePinEntireSolution}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-300 hover:bg-amber-200 text-slate-950 font-black text-xs shadow cursor-pointer"
                >
                  {pinnedIds['all_steps'] ? (
                    <>
                      <Check className="w-3.5 h-3.5" /> 칠판에 전체 부착됨!
                    </>
                  ) : (
                    <>
                      <Pin className="w-3.5 h-3.5" /> 전체 풀이 칠판에 붙이기
                    </>
                  )}
                </button>
              )}

              {solvePayload && (
                <button
                  type="button"
                  onClick={onOpenInspector}
                  title="서버 검증 & JSON 보기"
                  className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-emerald-300 cursor-pointer"
                >
                  <Code2 className="w-4 h-4" />
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white cursor-pointer"
                title="설명 시트 접기"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* 눈높이 모드(kid/high/adult) 3단계 토글 & 설명방식(solve/explain) 전환 바 */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <ModeThreeStageToggle mode={mode} onChange={onChangeMode} />

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  onChangeAction(action === 'solve' ? 'explain' : 'solve')
                }
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-amber-200 font-semibold border border-amber-300/30 cursor-pointer"
              >
                {action === 'solve' ? '모드: 풀이 중심(solve)' : '모드: 개념 설명(explain)'}
              </button>

              {solve && solve.status === 'ok' && (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await shareChalkboardSummary({
                      topic: solve.topic,
                      answer: solve.answer,
                    });
                    if (ok) {
                      setSharedToast(true);
                      window.setTimeout(() => setSharedToast(false), 2000);
                    }
                  }}
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 cursor-pointer"
                  title="풀이 공유/복사"
                >
                  <Share2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 시트 본문 영역 */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {sharedToast && (
            <div className="px-3 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs text-center">
              풀이 요약이 공유/복사되었습니다!
            </div>
          )}

          {/* 개인정보 마스킹 안내 (체크리스트 #6) */}
          {meta && meta.piiMaskedCount > 0 && (
            <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-sky-950/80 border border-sky-400/40 text-xs text-sky-200">
              <ShieldCheck className="w-4 h-4 text-sky-300 shrink-0" />
              <span>
                메모 내 개인정보({meta.piiTypes.join(', ')}) {meta.piiMaskedCount}건을 AI
                전송 전 마스킹 보호했습니다.
              </span>
            </div>
          )}

          {/* 에러 메시지 */}
          {errorMsg && (
            <div className="p-4 rounded-xl bg-rose-950/80 border border-rose-400/40 text-xs sm:text-sm text-rose-200">
              {errorMsg}
            </div>
          )}

          {/* 로딩 상태 */}
          {isSolving && (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-emerald-100">
              <Loader2 className="w-9 h-9 animate-spin text-amber-300" />
              <p className="text-sm sm:text-base font-bold">
                칠판에 적어두신 메모를 읽고 단계별 판서 설명을 만들고 있어요...
              </p>
            </div>
          )}

          {/* 1) status === "clarify" 되묻기 UI */}
          {!isSolving && solve && solve.status === 'clarify' && (
            <div className="rounded-2xl border-2 border-dashed border-amber-300/70 bg-black/30 p-5 space-y-3">
              <div className="flex items-center gap-2 text-amber-300 font-extrabold text-sm sm:text-base">
                <HelpCircle className="w-5 h-5 shrink-0" />
                <span>선생님의 짧은 되묻기 (질문 구체화 필요)</span>
              </div>
              <p className="text-base sm:text-lg font-bold text-white">
                &ldquo;{solve.clarify_question}&rdquo;
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (clarifyInput.trim()) {
                    onRetryWithQuestion(clarifyInput.trim());
                  }
                }}
                className="flex gap-2 pt-1"
              >
                <input
                  type="text"
                  value={clarifyInput}
                  onChange={(e) => setClarifyInput(e.target.value)}
                  placeholder="구체적인 수식이나 질문을 입력해 주세요 (예: x^2 - 5x + 6 = 0)"
                  className="flex-1 rounded-xl bg-black/50 border border-white/25 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-amber-300"
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 rounded-xl bg-amber-300 text-slate-950 font-black text-xs sm:text-sm shrink-0 cursor-pointer"
                >
                  다시 설명 요청
                </button>
              </form>
            </div>
          )}

          {/* 2) status === "unsupported" 안내 UI */}
          {!isSolving && solve && solve.status === 'unsupported' && (
            <div className="rounded-2xl border-2 border-dashed border-rose-400/70 bg-black/30 p-5 space-y-2">
              <div className="flex items-center gap-2 text-rose-300 font-extrabold text-sm sm:text-base">
                <ShieldAlert className="w-5 h-5 shrink-0" />
                <span>학습 범위를 벗어난 메모입니다</span>
              </div>
              <p className="text-sm sm:text-base text-rose-100 font-semibold">
                {solve.answer}
              </p>
            </div>
          )}

          {/* 3) status === "ok" 단계별 판서 카드 & [📌 내 칠판에 붙이기] */}
          {!isSolving && solve && solve.status === 'ok' && (
            <>
              <div className="flex items-center justify-between text-xs text-emerald-200/90 px-1">
                <span>
                  💡 마음에 드는 Step의 <strong>[📌 칠판에 붙이기]</strong>를 누르면 내 칠판
                  메모장으로 바로 복사됩니다.
                </span>
                {meta && meta.verifyResults.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 font-bold shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    수식 검산 완료 ({meta.verifyResults.length}건)
                  </span>
                )}
              </div>

              <div className="space-y-3">
                {solve.steps.map((step) => {
                  const isStepPinned = Boolean(pinnedIds[`step_${step.no}`]);
                  return (
                    <div
                      key={step.no}
                      className="rounded-2xl border border-white/20 bg-black/30 p-4 space-y-2.5 hover:border-amber-300/50 transition"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-amber-300 text-slate-950 font-black text-xs flex items-center justify-center">
                            {step.no}
                          </span>
                          <h3 className="text-sm sm:text-base font-extrabold text-amber-200">
                            {step.title}
                          </h3>
                        </div>

                        <button
                          type="button"
                          onClick={() => handlePinSingleStep(step)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                            isStepPinned
                              ? 'bg-emerald-500 text-slate-950'
                              : 'bg-white/10 hover:bg-amber-300 hover:text-slate-950 text-amber-200 border border-amber-300/30'
                          }`}
                        >
                          {isStepPinned ? (
                            <>
                              <Check className="w-3.5 h-3.5" /> 칠판에 붙임!
                            </>
                          ) : (
                            <>
                              <Pin className="w-3.5 h-3.5" /> 칠판에 붙이기
                            </>
                          )}
                        </button>
                      </div>

                      {/* 칠판 판서 줄 (최대 3줄) */}
                      <div className="rounded-xl bg-[#0b1f17] border border-emerald-400/25 px-4 py-3 space-y-1.5">
                        {step.board.map((line, lIdx) => (
                          <div
                            key={lIdx}
                            className="text-base sm:text-xl font-bold text-white tracking-wide"
                          >
                            <MathText text={line} highlights={step.highlight} />
                          </div>
                        ))}
                      </div>

                      {/* 말로 하는 설명 */}
                      <p className="text-xs sm:text-sm text-emerald-100/95 leading-relaxed">
                        👨‍🏫 <MathText text={step.explain} highlights={step.highlight} />
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* 최종 정답 박스 + 칠판에 붙이기 */}
              <div className="rounded-2xl border-2 border-amber-300/60 bg-black/40 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="px-2.5 py-1 rounded-lg bg-amber-300 text-slate-950 font-black text-xs">
                    최종 정답
                  </span>
                  <span className="text-base sm:text-xl font-black text-amber-200">
                    <MathText text={solve.answer} />
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handlePinFinalAnswer}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500/25 hover:bg-emerald-500/40 text-emerald-200 border border-emerald-400/40 text-xs font-bold cursor-pointer"
                >
                  {pinnedIds['final_answer'] ? (
                    <>
                      <Check className="w-3.5 h-3.5" /> 정답 카드 부착됨!
                    </>
                  ) : (
                    <>
                      <Pin className="w-3.5 h-3.5" /> 정답만 칠판에 붙이기
                    </>
                  )}
                </button>
              </div>

              {/* 온디맨드 2차 호출 (TASK=VIDEO): 재생 버튼을 누를 때만 영상 장면 생성 */}
              {!videoPayload ? (
                <div className="rounded-2xl border border-emerald-400/40 bg-emerald-950/50 p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="text-center sm:text-left">
                    <div className="text-xs font-extrabold text-emerald-300">
                      🎬 2차 호출 (TASK=VIDEO) · 상세 판서 애니메이션 강의
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5">
                      버튼을 누를 때만 판서 영상과 선생님 음성 나레이션을 생성하여 비용을 절약합니다.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onRequestVideo}
                    disabled={isGeneratingVideo}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 text-slate-950 font-black text-xs sm:text-sm shrink-0 shadow cursor-pointer"
                  >
                    {isGeneratingVideo ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        판서 영상 생성 중...
                      </>
                    ) : (
                      <>
                        <PlayCircle className="w-4 h-4" />
                        상세 설명 영상 재생
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <VideoChalkboardPlayer videoPayload={videoPayload} />
              )}

              {/* 흔한 실수 & 확인문제 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {solve.common_mistake && (
                  <div className="rounded-xl border border-rose-400/35 bg-black/30 p-3.5 space-y-1">
                    <div className="text-xs font-extrabold text-rose-300 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>학생이 자주 틀리는 실수</span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                      <MathText text={solve.common_mistake} />
                    </p>
                  </div>
                )}

                {solve.check_question && (
                  <div className="rounded-xl border border-amber-300/35 bg-black/30 p-3.5 space-y-2">
                    <div className="text-xs font-extrabold text-amber-300">
                      ✏️ 확인문제
                    </div>
                    <p className="text-xs sm:text-sm font-bold text-white">
                      Q. <MathText text={solve.check_question.q} />
                    </p>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={checkAnswerInput}
                        onChange={(e) => setCheckAnswerInput(e.target.value)}
                        placeholder="정답 입력..."
                        className="flex-1 rounded-lg bg-black/50 border border-white/20 px-2.5 py-1 text-xs text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCheckAnswer((s) => !s)}
                        className="px-2.5 py-1 rounded-lg bg-amber-300/25 text-amber-200 border border-amber-300/40 text-xs font-bold cursor-pointer"
                      >
                        {showCheckAnswer ? '숨기기' : '정답 보기'}
                      </button>
                    </div>
                    {showCheckAnswer && (
                      <div className="text-xs font-bold text-emerald-300 pt-1">
                        정답: <MathText text={solve.check_question.a} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* 시트 하단 닫기 바 */}
        <div className="px-4 py-2.5 bg-black/50 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
          <span>📌 칠판에 붙인 카드는 자유롭게 드래그해서 위치를 옮길 수 있어요.</span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold cursor-pointer"
          >
            <X className="w-3.5 h-3.5" /> 내 칠판으로 돌아가기
          </button>
        </div>
      </div>
    </div>
  );
};
