export type LearnMode = 'kid' | 'high' | 'adult';
export type LearnAction = 'solve' | 'explain';
export type SolveStatus = 'ok' | 'clarify' | 'unsupported';

export interface SolveStep {
  no: number;
  title: string;
  board: string[];
  explain: string;
  highlight: string[];
}

export interface VerifyItem {
  expr: string;
  expected: string;
}

export interface CheckQuestion {
  q: string;
  a: string;
}

export interface SolveResponse {
  status: SolveStatus;
  mode: LearnMode;
  topic: string;
  clarify_question: string | null;
  steps: SolveStep[];
  answer: string;
  verify: VerifyItem[];
  common_mistake: string;
  check_question: CheckQuestion | null;
}

export type BoardActionType =
  | 'write'
  | 'underline'
  | 'circle'
  | 'arrow'
  | 'highlight'
  | 'erase';

export type BoardAction =
  | {
      type: 'write';
      id: string;
      text: string;
      x: number;
      y: number;
      at: number;
    }
  | {
      type: 'underline';
      target: string;
      at: number;
    }
  | {
      type: 'circle';
      target: string;
      at: number;
    }
  | {
      type: 'arrow';
      from: string;
      to: string;
      at: number;
    }
  | {
      type: 'highlight';
      target: string;
      at: number;
    }
  | {
      type: 'erase';
      target: string; // id | 'all'
      at: number;
    };

export interface VideoScene {
  scene: number;
  step_ref: number;
  narration: string;
  seconds: number;
  board_actions: BoardAction[];
}

export interface VideoClosing {
  summary: string;
  check_question: CheckQuestion | null;
}

export interface VideoResponse {
  title: string;
  mode: LearnMode;
  total_seconds: number;
  scenes: VideoScene[];
  closing: VideoClosing;
}

export interface ValidationResult<T> {
  ok: boolean;
  data?: T;
  errors: string[];
}

export interface VerifyCheckDetail {
  expr: string;
  expected: string;
  actual: string;
  passed: boolean;
  engine: 'sympy' | 'mathjs';
}

export interface SolveApiPayload {
  solve: SolveResponse;
  meta: {
    attempts: number;
    maskedQuestion: string;
    piiMaskedCount: number;
    piiTypes: string[];
    verifyResults: VerifyCheckDetail[];
    allVerified: boolean;
    privacySavedLog: boolean;
    provider: string;
  };
}

export interface VideoApiPayload {
  video: VideoResponse;
  meta: {
    attempts: number;
    consistencyChecked: boolean;
    consistencyNotes: string[];
    provider: string;
  };
}

const ALLOWED_SOLVE_KEYS = new Set([
  'status',
  'mode',
  'topic',
  'clarify_question',
  'steps',
  'answer',
  'verify',
  'common_mistake',
  'check_question',
]);

const ALLOWED_STEP_KEYS = new Set(['no', 'title', 'board', 'explain', 'highlight']);
const ALLOWED_VERIFY_KEYS = new Set(['expr', 'expected']);
const ALLOWED_CHECK_Q_KEYS = new Set(['q', 'a']);

const ALLOWED_VIDEO_KEYS = new Set([
  'title',
  'mode',
  'total_seconds',
  'scenes',
  'closing',
]);
const ALLOWED_SCENE_KEYS = new Set([
  'scene',
  'step_ref',
  'narration',
  'seconds',
  'board_actions',
]);

/**
 * JSON 문자열 파싱 (모델이 실수로 앞뒤 공백이나 코드블록을 붙인 경우 정제하되 유효한 단일 JSON 객체인지 확인)
 */
export function parseStrictJson(raw: string): { ok: boolean; value?: unknown; error?: string } {
  const trimmed = raw.trim();
  let candidate = trimmed;

  // 만약 코드블록으로 감싸져 있다면 내부만 추출
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(candidate);
  if (fenceMatch) {
    candidate = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: '최상위 출력이 JSON 객체가 아닙니다.' };
    }
    return { ok: true, value: parsed };
  } catch (err) {
    return {
      ok: false,
      error: `JSON 파싱 실패: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 1차 호출 TASK=SOLVE 스키마 검증
 * - 스키마에 없는 키 금지
 * - 필수 필드 및 타입 검증
 */
export function validateSolveResponse(rawObj: unknown): ValidationResult<SolveResponse> {
  const errors: string[] = [];

  if (typeof rawObj !== 'object' || rawObj === null || Array.isArray(rawObj)) {
    return { ok: false, errors: ['응답이 JSON 객체가 아닙니다.'] };
  }

  const obj = rawObj as Record<string, unknown>;

  // 스키마 외 키 검사
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_SOLVE_KEYS.has(key)) {
      errors.push(`스키마에 없는 최상위 키가 포함되어 있습니다: "${key}"`);
    }
  }

  // 필수 키 존재 확인
  for (const reqKey of ALLOWED_SOLVE_KEYS) {
    if (!(reqKey in obj)) {
      errors.push(`필수 키가 누락되었습니다: "${reqKey}"`);
    }
  }

  if (obj.status !== 'ok' && obj.status !== 'clarify' && obj.status !== 'unsupported') {
    errors.push(`status 값이 유효하지 않습니다: ${String(obj.status)}`);
  }

  if (obj.mode !== 'kid' && obj.mode !== 'high' && obj.mode !== 'adult') {
    errors.push(`mode 값이 유효하지 않습니다: ${String(obj.mode)}`);
  }

  if (typeof obj.topic !== 'string') {
    errors.push('topic은 문자열이어야 합니다.');
  }

  if (obj.clarify_question !== null && typeof obj.clarify_question !== 'string') {
    errors.push('clarify_question은 문자열 또는 null이어야 합니다.');
  }

  if (obj.status === 'clarify' && (!obj.clarify_question || obj.clarify_question.trim() === '')) {
    errors.push('status="clarify"일 때 clarify_question은 비어 있을 수 없습니다.');
  }

  if (!Array.isArray(obj.steps)) {
    errors.push('steps는 배열이어야 합니다.');
  } else {
    if (obj.status === 'ok' && (obj.steps.length < 1 || obj.steps.length > 6)) {
      errors.push(`status="ok"일 때 steps 개수는 1~6개여야 합니다 (현재 ${obj.steps.length}개).`);
    }
    obj.steps.forEach((step, idx) => {
      if (typeof step !== 'object' || step === null || Array.isArray(step)) {
        errors.push(`steps[${idx}]가 객체가 아닙니다.`);
        return;
      }
      const s = step as Record<string, unknown>;
      for (const k of Object.keys(s)) {
        if (!ALLOWED_STEP_KEYS.has(k)) {
          errors.push(`steps[${idx}]에 스키마 외 키가 있습니다: "${k}"`);
        }
      }
      if (typeof s.no !== 'number') errors.push(`steps[${idx}].no는 숫자여야 합니다.`);
      if (typeof s.title !== 'string') {
        errors.push(`steps[${idx}].title은 문자열이어야 합니다.`);
      }
      if (!Array.isArray(s.board) || !s.board.every((b) => typeof b === 'string')) {
        errors.push(`steps[${idx}].board는 문자열 배열이어야 합니다.`);
      } else if (s.board.length > 3) {
        errors.push(`steps[${idx}].board는 최대 3줄이어야 합니다 (현재 ${s.board.length}줄).`);
      }
      if (typeof s.explain !== 'string') {
        errors.push(`steps[${idx}].explain은 문자열이어야 합니다.`);
      }
      if (!Array.isArray(s.highlight) || !s.highlight.every((h) => typeof h === 'string')) {
        errors.push(`steps[${idx}].highlight는 문자열 배열이어야 합니다.`);
      }
    });
  }

  if (typeof obj.answer !== 'string') {
    errors.push('answer는 문자열이어야 합니다.');
  }

  if (!Array.isArray(obj.verify)) {
    errors.push('verify는 배열이어야 합니다.');
  } else {
    obj.verify.forEach((v, idx) => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        errors.push(`verify[${idx}]가 객체가 아닙니다.`);
        return;
      }
      const vo = v as Record<string, unknown>;
      for (const k of Object.keys(vo)) {
        if (!ALLOWED_VERIFY_KEYS.has(k)) {
          errors.push(`verify[${idx}]에 스키마 외 키가 있습니다: "${k}"`);
        }
      }
      if (typeof vo.expr !== 'string' || typeof vo.expected !== 'string') {
        errors.push(`verify[${idx}]의 expr과 expected는 모두 문자열이어야 합니다.`);
      }
    });
  }

  if (typeof obj.common_mistake !== 'string') {
    errors.push('common_mistake는 문자열이어야 합니다.');
  }

  if (obj.check_question !== null) {
    if (typeof obj.check_question !== 'object' || Array.isArray(obj.check_question)) {
      errors.push('check_question은 객체 또는 null이어야 합니다.');
    } else {
      const cq = obj.check_question as Record<string, unknown>;
      for (const k of Object.keys(cq)) {
        if (!ALLOWED_CHECK_Q_KEYS.has(k)) {
          errors.push(`check_question에 스키마 외 키가 있습니다: "${k}"`);
        }
      }
      if (typeof cq.q !== 'string' || typeof cq.a !== 'string') {
        errors.push('check_question.q와 check_question.a는 문자열이어야 합니다.');
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, data: obj as unknown as SolveResponse, errors: [] };
}

/**
 * 2차 호출 TASK=VIDEO 스키마 검증
 */
export function validateVideoResponse(rawObj: unknown): ValidationResult<VideoResponse> {
  const errors: string[] = [];

  if (typeof rawObj !== 'object' || rawObj === null || Array.isArray(rawObj)) {
    return { ok: false, errors: ['VIDEO 응답이 JSON 객체가 아닙니다.'] };
  }

  const obj = rawObj as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!ALLOWED_VIDEO_KEYS.has(key)) {
      errors.push(`VIDEO 스키마에 없는 최상위 키가 포함되어 있습니다: "${key}"`);
    }
  }

  if (typeof obj.title !== 'string') errors.push('title은 문자열이어야 합니다.');
  if (obj.mode !== 'kid' && obj.mode !== 'high' && obj.mode !== 'adult') {
    errors.push(`mode 값이 유효하지 않습니다: ${String(obj.mode)}`);
  }
  if (typeof obj.total_seconds !== 'number' || obj.total_seconds <= 0) {
    errors.push('total_seconds는 양수여야 합니다.');
  }

  if (!Array.isArray(obj.scenes)) {
    errors.push('scenes는 배열이어야 합니다.');
  } else {
    if (obj.scenes.length < 4 || obj.scenes.length > 10) {
      errors.push(`scenes 개수는 4~10개여야 합니다 (현재 ${obj.scenes.length}개).`);
    }

    const writeIds = new Set<string>();

    obj.scenes.forEach((sc, idx) => {
      if (typeof sc !== 'object' || sc === null || Array.isArray(sc)) {
        errors.push(`scenes[${idx}]가 객체가 아닙니다.`);
        return;
      }
      const s = sc as Record<string, unknown>;
      for (const k of Object.keys(s)) {
        if (!ALLOWED_SCENE_KEYS.has(k)) {
          errors.push(`scenes[${idx}]에 스키마 외 키가 있습니다: "${k}"`);
        }
      }
      if (typeof s.scene !== 'number') errors.push(`scenes[${idx}].scene은 숫자여야 합니다.`);
      if (typeof s.step_ref !== 'number') errors.push(`scenes[${idx}].step_ref는 숫자여야 합니다.`);
      if (typeof s.narration !== 'string' || !s.narration.trim()) {
        errors.push(`scenes[${idx}].narration은 비어 있지 않은 문자열이어야 합니다.`);
      }
      if (typeof s.seconds !== 'number' || s.seconds <= 0) {
        errors.push(`scenes[${idx}].seconds는 양수여야 합니다.`);
      }

      if (!Array.isArray(s.board_actions)) {
        errors.push(`scenes[${idx}].board_actions는 배열이어야 합니다.`);
      } else {
        s.board_actions.forEach((act, aIdx) => {
          if (typeof act !== 'object' || act === null || Array.isArray(act)) {
            errors.push(`scenes[${idx}].board_actions[${aIdx}]가 객체가 아닙니다.`);
            return;
          }
          const a = act as Record<string, unknown>;
          const t = a.type;
          if (typeof a.at !== 'number' || a.at < 0) {
            errors.push(`scenes[${idx}].board_actions[${aIdx}].at은 0 이상의 숫자여야 합니다.`);
          }
          if (t === 'write') {
            if (typeof a.id !== 'string' || !a.id) {
              errors.push(`scenes[${idx}].board_actions[${aIdx}] write에는 고유 id가 필요합니다.`);
            } else {
              writeIds.add(a.id);
            }
            if (typeof a.text !== 'string') {
              errors.push(`scenes[${idx}].board_actions[${aIdx}] write.text는 문자열이어야 합니다.`);
            }
            if (typeof a.x !== 'number' || a.x < 0 || a.x > 1) {
              errors.push(`scenes[${idx}].board_actions[${aIdx}] write.x는 0~1 범위여야 합니다.`);
            }
            if (typeof a.y !== 'number' || a.y < 0 || a.y > 1) {
              errors.push(`scenes[${idx}].board_actions[${aIdx}] write.y는 0~1 범위여야 합니다.`);
            }
          } else if (t === 'underline' || t === 'circle' || t === 'highlight' || t === 'erase') {
            if (typeof a.target !== 'string' || !a.target) {
              errors.push(`scenes[${idx}].board_actions[${aIdx}] ${t}.target은 문자열이어야 합니다.`);
            }
          } else if (t === 'arrow') {
            if (typeof a.from !== 'string' || typeof a.to !== 'string') {
              errors.push(`scenes[${idx}].board_actions[${aIdx}] arrow에는 from, to 문자열이 필요합니다.`);
            }
          } else {
            errors.push(`scenes[${idx}].board_actions[${aIdx}] 허용되지 않은 type입니다: ${String(t)}`);
          }
        });
      }
    });
  }

  if (typeof obj.closing !== 'object' || obj.closing === null || Array.isArray(obj.closing)) {
    errors.push('closing은 객체여야 합니다.');
  } else {
    const cl = obj.closing as Record<string, unknown>;
    if (typeof cl.summary !== 'string') {
      errors.push('closing.summary는 문자열이어야 합니다.');
    }
    if (cl.check_question !== null) {
      if (typeof cl.check_question !== 'object' || Array.isArray(cl.check_question)) {
        errors.push('closing.check_question은 객체 또는 null이어야 합니다.');
      } else {
        const cq = cl.check_question as Record<string, unknown>;
        if (typeof cq.q !== 'string' || typeof cq.a !== 'string') {
          errors.push('closing.check_question.q와 a는 문자열이어야 합니다.');
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, data: obj as unknown as VideoResponse, errors: [] };
}
