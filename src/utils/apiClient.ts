import {
  executeSolvePipeline,
  executeVideoPipeline,
} from '../server/aiService';
import type {
  LearnAction,
  LearnMode,
  SolveApiPayload,
  SolveResponse,
  VideoApiPayload,
} from '../shared/schema';

/**
 * 1차 호출: TASK=SOLVE
 */
export async function requestSolve(params: {
  mode: LearnMode;
  action: LearnAction;
  question: string;
}): Promise<SolveApiPayload> {
  try {
    const res = await fetch('/api/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      return (await res.json()) as SolveApiPayload;
    }
  } catch {
    // 정적 번들(.ait) 환경 등에서 서버 미연결 시 동일 검증 파이프라인을 클라이언트에서 수행
  }
  return executeSolvePipeline(params);
}

/**
 * 2차 호출: TASK=VIDEO (비용 절약을 위해 사용자가 영상 재생 버튼을 누를 때만 호출)
 */
export async function requestVideo(params: {
  mode: LearnMode;
  solveResult: SolveResponse;
}): Promise<VideoApiPayload> {
  try {
    const res = await fetch('/api/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: params.mode,
        solve_result: params.solveResult,
      }),
    });
    if (res.ok) {
      return (await res.json()) as VideoApiPayload;
    }
  } catch {
    // 정적 번들(.ait) 환경 폴백
  }
  return executeVideoPipeline(params);
}
