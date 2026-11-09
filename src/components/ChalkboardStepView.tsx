import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Layers,
  Loader2,
  PlayCircle,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { SolveApiPayload, VideoApiPayload } from '../shared/schema';
import { shareChalkboardSummary, triggerAitHaptic } from '../utils/aitBridge';
import { MathText } from './MathText';
import { VideoChalkboardPlayer } from './VideoChalkboardPlayer';

interface ChalkboardStepViewProps {
  solvePayload: SolveApiPayload;
  videoPayload: VideoApiPayload | null;
  isGeneratingVideo: boolean;
  onRequestVideo: () => void;
  onClarifySubmit: (refinedQuestion: string) => void;
}

export const ChalkboardStepView: React.FC<ChalkboardStepViewProps> = ({
  solvePayload,
  videoPayload,
  isGeneratingVideo,
  onRequestVideo,
  onClarifySubmit,
}) => {
  const { solve, meta } = solvePayload;
  const [stepViewMode, setStepViewMode] = useState<'all' | 'single'>('all');
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [userCheckInput, setUserCheckInput] = useState('');
  const [revealCheckAnswer, setRevealCheckAnswer] = useState(false);
  const [clarifyReply, setClarifyReply] = useState('');
  const [sharedToast, setSharedToast] = useState(false);

  // 체크리스트 #3: status === "clarify" 이면 되묻기 UI 표시
  if (solve.status === 'clarify') {
    const quickExamples =
      solve.mode === 'kid'
        ? ['1 + 1 = ?', '3 + 5 = ?', '사과 4개 더하기 2개']
        : solve.mode === 'high'
          ? ['x^2 - 5x + 6 = 0', '피타고라스 정리 설명해줘', '(12 + 8) * 3 = ?']
          : ['복리 계산 원리 알려줘', 'x^2 - 5x + 6 = 0', '피타고라스 정리'];

    return (
      <div className="rounded-2xl border-2 border-amber-500/40 bg-slate-900/90 p-5 sm:p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-300 shrink-0">
            <HelpCircle className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 mb-1.5">
              status=&quot;clarify&quot; · 선생님의 짧은 되묻기
            </span>
            <h3 className="text-base sm:text-lg font-bold text-white mb-1">
              {solve.clarify_question || '질문을 조금 더 구체적으로 알려주시겠어요?'}
            </h3>
            <p className="text-xs sm:text-sm text-slate-400 mb-4">
              질문이 모호할 때는 추측해서 풀지 않고 정확히 여쭤본 뒤 칠판 풀이를 시작합니다.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (clarifyReply.trim()) {
                  onClarifySubmit(clarifyReply.trim());
                }
              }}
              className="flex flex-col sm:flex-row gap-2 mb-3"
            >
              <input
                type="text"
                value={clarifyReply}
                onChange={(e) => setClarifyReply(e.target.value)}
                placeholder="구체적인 수식이나 조건을 입력해 주세요..."
                className="flex-1 rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
              />
              <button
                type="submit"
                className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm shrink-0"
              >
                다시 질문하기
              </button>
            </form>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-400 mr-1">추천 질문 예시:</span>
              {quickExamples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => onClarifySubmit(ex)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-amber-200 border border-slate-700"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 체크리스트 #3: status === "unsupported" 이면 안내 문구 표시
  if (solve.status === 'unsupported') {
    return (
      <div className="rounded-2xl border-2 border-rose-500/40 bg-slate-900/90 p-5 sm:p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-300 shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 mb-1.5">
              status=&quot;unsupported&quot; · 지원 범위 안내
            </span>
            <h3 className="text-base sm:text-lg font-bold text-white mb-1">
              {solve.answer || '교육 및 학습과 무관하거나 부적절한 요청은 답변할 수 없습니다.'}
            </h3>
            <p className="text-xs sm:text-sm text-slate-400 mb-3">
              AI 칠판은 수학·과학·개념 학습 등 교육 목적의 질문만 안전하게 풀이합니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  onClarifySubmit(solve.mode === 'kid' ? '1+1=?' : 'x^2 - 5x + 6 = 0')
                }
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-emerald-300 border border-emerald-500/30"
              >
                학습 예제 문제로 돌아가기
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // status === "ok": 메인 칠판 화면
  const stepsToRender =
    stepViewMode === 'all'
      ? solve.steps
      : [solve.steps[Math.min(activeStepIdx, solve.steps.length - 1)]].filter(Boolean);

  const modeBadgeLabel: Record<typeof solve.mode, string> = {
    kid: '🐣 유아·어린이 모드 (보호자 동반 화면)',
    high: '🎓 고등학생 모드 (1타 강사 정석 풀이)',
    adult: '💼 성인 모드 (핵심 원리 + 실생활 예시)',
  };

  return (
    <div className="space-y-5">
      {/* 개인정보 마스킹 알림 (체크리스트 #6 작동 시 표시) */}
      {meta.piiMaskedCount > 0 && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-sky-950/60 border border-sky-500/40 text-xs text-sky-200">
          <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
          <span>
            <strong>개인정보 자동 보호 작동:</strong> 질문에 포함된 개인정보(
            {meta.piiTypes.join(', ')}) {meta.piiMaskedCount}건을 AI 전송 전에{' '}
            <code className="text-sky-300 font-semibold">{meta.maskedQuestion}</code>로
            안전하게 마스킹했습니다.
          </span>
        </div>
      )}

      {/* 칠판 본체 프레임 */}
      <div className="rounded-2xl border-4 border-[#6b4423] bg-gradient-to-b from-[#113325] via-[#0e2a1f] to-[#0b2219] shadow-2xl overflow-hidden">
        {/* 칠판 상단 바 */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3.5 bg-black/30 border-b border-emerald-500/20">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
              {modeBadgeLabel[solve.mode]}
            </span>
            <h2 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
              <MathText text={solve.topic} />
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {/* 서버 수식 검증(verify) 통과 배지 */}
            {meta.verifyResults.length > 0 && (
              <span
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-200 border border-emerald-400/40"
                title={meta.verifyResults
                  .map((v) => `${v.expr} = ${v.actual} (기대값 ${v.expected})`)
                  .join('\n')}
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                수식 서버 검증 통과 ({meta.verifyResults.length}건)
              </span>
            )}

            {/* 보기 방식 전환 버튼 */}
            <button
              type="button"
              onClick={() => {
                triggerAitHaptic('tap');
                setStepViewMode((m) => (m === 'all' ? 'single' : 'all'));
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-900/70 hover:bg-slate-900 text-slate-200 border border-white/15 cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5" />
              {stepViewMode === 'all' ? '한 Step씩 집중 보기' : '전체 Step 한눈에 보기'}
            </button>

            {/* 앱인토스 브릿지 공유 버튼 */}
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
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-400/30 cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5" />
              {sharedToast ? '공유/복사 완료!' : '판서 공유'}
            </button>
          </div>
        </div>

        {/* 한 단계씩 보기일 때 네비게이션 */}
        {stepViewMode === 'single' && (
          <div className="flex items-center justify-between px-4 sm:px-6 py-2.5 bg-black/20 border-b border-white/10">
            <button
              type="button"
              disabled={activeStepIdx === 0}
              onClick={() => setActiveStepIdx((i) => Math.max(0, i - 1))}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-35 text-xs font-semibold text-white"
            >
              <ChevronLeft className="w-4 h-4" /> 이전 Step
            </button>
            <div className="flex items-center gap-1.5">
              {solve.steps.map((s, idx) => (
                <button
                  key={s.no}
                  type="button"
                  onClick={() => setActiveStepIdx(idx)}
                  className={`w-7 h-7 rounded-full text-xs font-bold transition ${
                    idx === activeStepIdx
                      ? 'bg-amber-400 text-slate-950 shadow'
                      : 'bg-white/10 text-slate-300 hover:bg-white/20'
                  }`}
                >
                  {s.no}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={activeStepIdx === solve.steps.length - 1}
              onClick={() =>
                setActiveStepIdx((i) => Math.min(solve.steps.length - 1, i + 1))
              }
              className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-35 text-xs font-semibold text-white"
            >
              다음 Step <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 칠판 Step 카드 그리드 */}
        <div className="p-4 sm:p-6 grid grid-cols-1 gap-4">
          {stepsToRender.map((step) => (
            <div
              key={step.no}
              className="rounded-xl bg-black/25 border border-white/15 p-4 sm:p-5 backdrop-blur-sm transition hover:border-emerald-400/40"
            >
              {/* Step 번호 및 12자 이내 제목 */}
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-400 text-slate-950 font-extrabold text-xs">
                    {step.no}
                  </span>
                  <h3 className="text-sm sm:text-base font-bold text-amber-200">
                    {step.title}
                  </h3>
                </div>
                {step.highlight.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {step.highlight.map((hl, hIdx) => (
                      <span
                        key={hIdx}
                        className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-400/20 text-amber-200 border border-amber-300/30"
                      >
                        핵심: {hl}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 칠판 판서 영역 (board: 최대 3줄) */}
              <div className="rounded-lg bg-[#091f16]/90 border border-emerald-500/25 px-4 py-3.5 mb-3 space-y-2 shadow-inner">
                {step.board.map((line, lIdx) => (
                  <div
                    key={lIdx}
                    className="text-base sm:text-xl font-bold text-white tracking-wide leading-relaxed"
                  >
                    <MathText text={line} highlights={step.highlight} />
                  </div>
                ))}
              </div>

              {/* 말로 하는 설명 (explain: 1~2문장) */}
              <div className="flex items-start gap-2 text-xs sm:text-sm text-emerald-100/95 leading-relaxed">
                <span className="shrink-0 mt-0.5">👨‍🏫</span>
                <p>
                  <MathText text={step.explain} highlights={step.highlight} />
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* 칠판 하단 최종 정답 & 검산 수식 바 */}
        <div className="px-4 sm:px-6 py-4 bg-black/40 border-t border-emerald-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="px-3 py-1 rounded-lg bg-amber-400 text-slate-950 font-extrabold text-xs sm:text-sm shrink-0">
              최종 정답
            </span>
            <span className="text-base sm:text-xl font-extrabold text-amber-200">
              <MathText text={solve.answer} />
            </span>
          </div>

          {meta.verifyResults.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-emerald-300">
              <span className="text-slate-400">검산식(verify):</span>
              {meta.verifyResults.map((v, i) => (
                <code
                  key={i}
                  className="px-2 py-0.5 rounded bg-emerald-950/90 border border-emerald-500/30 text-emerald-200"
                >
                  {v.expr} = {v.expected} ✓
                </code>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2차 호출 (TASK=VIDEO) 트리거 영역: 재생 버튼을 누를 때만 생성하여 비용 절약 */}
      {!videoPayload ? (
        <div className="rounded-2xl border border-emerald-500/35 bg-gradient-to-r from-emerald-950/60 via-slate-900 to-emerald-950/60 p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="space-y-1 text-center sm:text-left">
            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300">
              <Sparkles className="w-4 h-4" />
              2차 호출 (TASK=VIDEO) · 온디맨드 생성
            </div>
            <h4 className="text-sm sm:text-base font-bold text-white">
              선생님의 칠판 판서 애니메이션과 음성 강의로 다시 볼까요?
            </h4>
            <p className="text-xs text-slate-400">
              비용 절약을 위해 상세 설명 영상(VIDEO)은 재생 버튼을 누를 때만 SOLVE 결과를 바탕으로 생성합니다.
            </p>
          </div>

          <button
            type="button"
            onClick={onRequestVideo}
            disabled={isGeneratingVideo}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-extrabold text-sm shadow-lg shadow-emerald-500/20 shrink-0 transition cursor-pointer"
          >
            {isGeneratingVideo ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                판서 영상 장면 생성 중...
              </>
            ) : (
              <>
                <PlayCircle className="w-5 h-5" />
                상세 설명 영상 재생
              </>
            )}
          </button>
        </div>
      ) : (
        <VideoChalkboardPlayer videoPayload={videoPayload} />
      )}

      {/* 하단 2단 카드: 흔한 실수 1가지 + 확인문제 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 흔한 실수 (common_mistake) */}
        <div className="rounded-2xl border border-rose-500/30 bg-slate-900/90 p-4 sm:p-5">
          <div className="flex items-center gap-2 text-rose-300 font-bold text-sm mb-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>1타 강사 포인트: 학생이 자주 틀리는 실수</span>
          </div>
          <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
            <MathText text={solve.common_mistake} />
          </p>
        </div>

        {/* 확인문제 (check_question) */}
        {solve.check_question && (
          <div className="rounded-2xl border border-amber-500/30 bg-slate-900/90 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-amber-300 font-bold text-sm">
                ✏️ 실력 다지기 확인문제
              </span>
              <button
                type="button"
                onClick={() => setRevealCheckAnswer((r) => !r)}
                className="text-xs font-semibold text-amber-300 hover:underline"
              >
                {revealCheckAnswer ? '정답 숨기기' : '정답 바로 보기'}
              </button>
            </div>

            <p className="text-xs sm:text-sm text-white font-medium mb-3">
              Q. <MathText text={solve.check_question.q} />
            </p>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={userCheckInput}
                onChange={(e) => setUserCheckInput(e.target.value)}
                placeholder="내 답안을 입력해 보세요"
                className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
              />
              <button
                type="button"
                onClick={() => setRevealCheckAnswer(true)}
                className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/30 text-xs font-bold shrink-0"
              >
                채점하기
              </button>
            </div>

            {revealCheckAnswer && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-xs text-emerald-200 flex items-center justify-between">
                <span>
                  <strong>정답:</strong> <MathText text={solve.check_question.a} />
                </span>
                {userCheckInput.trim() && (
                  <span className="font-bold">
                    {solve.check_question.a
                      .replace(/\s+/g, '')
                      .includes(userCheckInput.trim().replace(/\s+/g, ''))
                      ? '🎉 정답과 일치해요!'
                      : '💡 정답을 확인해 보세요!'}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
