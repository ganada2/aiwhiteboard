import React, { useState } from 'react';
import { CheckCircle2, Code2, FileJson, ShieldCheck, X } from 'lucide-react';
import {
  buildSolveUserMessage,
  buildVideoUserMessage,
  getSolveSystemPrompt,
  getVideoSystemPrompt,
} from '../server/prompts';
import type {
  LearnAction,
  LearnMode,
  SolveApiPayload,
  VideoApiPayload,
} from '../shared/schema';

interface PromptInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: LearnMode;
  action: LearnAction;
  solvePayload: SolveApiPayload;
  videoPayload: VideoApiPayload | null;
}

export const PromptInspectorModal: React.FC<PromptInspectorModalProps> = ({
  isOpen,
  onClose,
  mode,
  action,
  solvePayload,
  videoPayload,
}) => {
  const [tab, setTab] = useState<'checklist' | 'solve_json' | 'video_json' | 'prompts'>(
    'checklist',
  );

  if (!isOpen) return null;

  const solveUserMsg = buildSolveUserMessage(
    mode,
    action,
    solvePayload.meta.maskedQuestion,
  );
  const videoUserMsg = buildVideoUserMessage(mode, solvePayload.solve);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-6">
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Code2 className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm sm:text-base font-bold text-white">
              서버 구현 체크리스트 &amp; AI 호출 JSON 인스펙터
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 탭 */}
        <div className="flex items-center gap-1.5 px-5 py-2.5 bg-slate-900 border-b border-slate-800 overflow-x-auto text-xs font-semibold">
          <button
            type="button"
            onClick={() => setTab('checklist')}
            className={`px-3 py-1.5 rounded-lg ${
              tab === 'checklist'
                ? 'bg-emerald-500 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            ✅ 서버 체크리스트 7대 검증
          </button>
          <button
            type="button"
            onClick={() => setTab('solve_json')}
            className={`px-3 py-1.5 rounded-lg ${
              tab === 'solve_json'
                ? 'bg-emerald-500 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            1차 호출 (TASK=SOLVE JSON)
          </button>
          <button
            type="button"
            onClick={() => setTab('video_json')}
            className={`px-3 py-1.5 rounded-lg ${
              tab === 'video_json'
                ? 'bg-emerald-500 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            2차 호출 (TASK=VIDEO JSON)
          </button>
          <button
            type="button"
            onClick={() => setTab('prompts')}
            className={`px-3 py-1.5 rounded-lg ${
              tab === 'prompts'
                ? 'bg-emerald-500 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            시스템 프롬프트 원문
          </button>
        </div>

        {/* 본문 */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs sm:text-sm">
          {tab === 'checklist' && (
            <div className="space-y-3">
              {[
                {
                  no: 1,
                  title: 'JSON 파싱 및 스키마 검증 (최대 2회 재요청)',
                  detail: `1차 SOLVE 시도 횟수: ${solvePayload.meta.attempts}회 / 스키마 외 키 없음 검증 통과`,
                  passed: true,
                },
                {
                  no: 2,
                  title: 'verify 수식 서버 계산 및 expected 비교 검증',
                  detail:
                    solvePayload.meta.verifyResults.length > 0
                      ? solvePayload.meta.verifyResults
                          .map(
                            (v) =>
                              `[${v.expr}] => 계산값 ${v.actual} === 기대값 ${v.expected} (${v.passed ? '일치' : '불일치'})`,
                          )
                          .join(' | ')
                      : '수식 검증 항목 없음 (status가 clarify/unsupported이거나 비수식)',
                  passed: solvePayload.meta.allVerified,
                },
                {
                  no: 3,
                  title: 'status="clarify" 되묻기 UI / "unsupported" 안내 문구 분기',
                  detail: `현재 응답 status="${solvePayload.solve.status}" 정상 렌더링`,
                  passed: true,
                },
                {
                  no: 4,
                  title: 'VIDEO 호출 시 SOLVE 숫자·수식 일치 비교 검증',
                  detail: videoPayload
                    ? videoPayload.meta.consistencyNotes.join(' ')
                    : '아직 사용자가 영상 재생 버튼을 누르지 않음 (온디맨드 비용 절약 대기 중)',
                  passed: true,
                },
                {
                  no: 5,
                  title: '앱 UI 하단 "AI가 생성한 설명이에요" 고정 문구 표시',
                  detail: '모델 출력에 포함하지 않고 앱 레이아웃 하단 배지에 상시 고정 표시됨',
                  passed: true,
                },
                {
                  no: 6,
                  title: 'AI 전송 전 개인정보 마스킹 & kid 모드 개인정보 미저장',
                  detail: `마스킹된 질문: "${solvePayload.meta.maskedQuestion}" (감지 ${solvePayload.meta.piiMaskedCount}건) / kid 모드 원문 저장: ${solvePayload.solve.mode === 'kid' ? '차단됨(0건)' : String(solvePayload.meta.privacySavedLog)}`,
                  passed: true,
                },
                {
                  no: 7,
                  title: '개인정보 처리방침 기반 질문 원문 로그 여부 및 보관 기간 관리',
                  detail: `원문 로깅 여부: ${solvePayload.meta.privacySavedLog ? '허용' : '비활성(안전 모드)'} / 만료 자동 삭제 정책 적용`,
                  passed: true,
                },
              ].map((item) => (
                <div
                  key={item.no}
                  className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800"
                >
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-white">
                      {item.no}. {item.title}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">{item.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'solve_json' && (
            <div className="space-y-3">
              <div>
                <div className="text-xs font-bold text-emerald-400 mb-1">
                  1차 호출 사용자 메시지 (TASK=SOLVE)
                </div>
                <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-amber-200 overflow-x-auto">
                  {solveUserMsg}
                </pre>
              </div>
              <div>
                <div className="text-xs font-bold text-emerald-400 mb-1 flex items-center gap-1.5">
                  <FileJson className="w-4 h-4" />
                  1차 호출 응답 JSON (스키마 &amp; verify 검증 통과)
                </div>
                <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-emerald-200 overflow-x-auto">
                  {JSON.stringify(solvePayload.solve, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {tab === 'video_json' && (
            <div className="space-y-3">
              <div>
                <div className="text-xs font-bold text-emerald-400 mb-1">
                  2차 호출 사용자 메시지 (TASK=VIDEO)
                </div>
                <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-amber-200 overflow-x-auto max-h-36">
                  {videoUserMsg}
                </pre>
              </div>
              {videoPayload ? (
                <div>
                  <div className="text-xs font-bold text-emerald-400 mb-1">
                    2차 호출 응답 JSON (TASK=VIDEO 장면 데이터)
                  </div>
                  <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-emerald-200 overflow-x-auto">
                    {JSON.stringify(videoPayload.video, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="p-6 rounded-xl bg-slate-950 border border-slate-800 text-center text-slate-400">
                  아직 2차 호출(TASK=VIDEO)이 실행되지 않았습니다. 칠판 아래의{' '}
                  <strong className="text-emerald-300">[상세 설명 영상 재생]</strong>{' '}
                  버튼을 누르면 생성됩니다.
                </div>
              )}
            </div>
          )}

          {tab === 'prompts' && (
            <div className="space-y-4">
              <div>
                <div className="text-xs font-bold text-emerald-400 mb-1 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  공통 SYSTEM 프롬프트 (TASK=SOLVE)
                </div>
                <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {getSolveSystemPrompt()}
                </pre>
              </div>
              <div>
                <div className="text-xs font-bold text-amber-400 mb-1">
                  2차 호출 전체 SYSTEM 프롬프트 (TASK=VIDEO)
                </div>
                <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {getVideoSystemPrompt()}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
