import type { LearnMode } from '../shared/schema';
import { getEnv } from './env';

export interface MaskPiiResult {
  maskedText: string;
  maskedCount: number;
  detectedTypes: string[];
}

export interface PrivacyLogEntry {
  id: string;
  timestamp: string;
  expiresAt: string;
  mode: LearnMode;
  topic: string;
  status: string;
  questionLog: string | null; // kid 모드이거나 LOG_RAW_QUESTION=false이면 null
}

// 메모리 내 감사 로그 저장소 (보관 기간 만료 시 자동 정리)
const auditLogs: PrivacyLogEntry[] = [];

/**
 * 체크리스트 #6: 사용자 입력에서 이름·연락처·이메일·주민번호·주소 등 개인정보를 AI로 보내기 전에 마스킹
 */
export function maskPersonalInformation(input: string): MaskPiiResult {
  let text = input;
  let maskedCount = 0;
  const detectedTypes = new Set<string>();

  // 1. 주민등록번호 패턴 (6자리-7자리)
  text = text.replace(/\b\d{6}\s*[-~]\s*[1-4]\d{6}\b/g, () => {
    maskedCount++;
    detectedTypes.add('주민등록번호');
    return '[주민번호마스킹]';
  });

  // 2. 휴대전화 및 일반 전화번호 패턴
  text = text.replace(
    /\b(?:01[016789]|02|0[3-6][1-5])\s*[-.\s]?\s*\d{3,4}\s*[-.\s]?\s*\d{4}\b/g,
    () => {
      maskedCount++;
      detectedTypes.add('연락처');
      return '[연락처마스킹]';
    },
  );

  // 3. 이메일 주소 패턴
  text = text.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    () => {
      maskedCount++;
      detectedTypes.add('이메일');
      return '[이메일마스킹]';
    },
  );

  // 4. 한국어 자기소개형 이름 표현 ("내 이름은 김철수야", "저는 박지민입니다", "나는 이영희인데")
  text = text.replace(
    /(내\s*이름은|제\s*이름은|나는|저는)\s*([가-힣]{2,4})(이야|야|입니다|이에요|예요|인데|라고\s*해)/g,
    (_full, prefix: string, _name: string, suffix: string) => {
      maskedCount++;
      detectedTypes.add('이름');
      return `${prefix} [이름마스킹]${suffix}`;
    },
  );

  // 5. 학교·반·번호 개인 식별 패턴 ("OO초등학교 3학년 2반")
  text = text.replace(
    /([가-힣]{2,10}(?:초등학교|중학교|고등학교|유치원))\s*(\d+\s*학년\s*\d+\s*반(?:\s*\d+\s*번)?)/g,
    () => {
      maskedCount++;
      detectedTypes.add('학교/학번');
      return '[학교정보마스킹]';
    },
  );

  return {
    maskedText: text,
    maskedCount,
    detectedTypes: Array.from(detectedTypes),
  };
}

/**
 * 체크리스트 #6 & #7:
 * - kid 모드에서는 아이의 개인정보 및 질문 원문을 절대 저장하지 않는다.
 * - 로그에 질문 원문을 남길지 여부(LOG_RAW_QUESTION)와 보관 기간(LOG_RETENTION_DAYS)을 개인정보 처리방침에 맞춰 적용한다.
 */
export function recordPrivacySafeLog(params: {
  mode: LearnMode;
  maskedQuestion: string;
  topic: string;
  status: string;
}): { savedRawQuestion: boolean; retentionDays: number } {
  const retentionDays = Number(getEnv('LOG_RETENTION_DAYS') || 7);
  const allowRawLog = getEnv('LOG_RAW_QUESTION') === 'true';

  // 만료된 로그 먼저 정리
  const now = Date.now();
  for (let i = auditLogs.length - 1; i >= 0; i--) {
    if (new Date(auditLogs[i].expiresAt).getTime() <= now) {
      auditLogs.splice(i, 1);
    }
  }

  // kid 모드는 개인정보 보호 원칙에 따라 원문 로그를 일체 남기지 않음
  if (params.mode === 'kid') {
    return { savedRawQuestion: false, retentionDays: 0 };
  }

  const shouldSaveQuestion = allowRawLog;
  const expiresAt = new Date(now + retentionDays * 24 * 60 * 60 * 1000).toISOString();

  auditLogs.push({
    id: `log_${now}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date(now).toISOString(),
    expiresAt,
    mode: params.mode,
    topic: params.topic,
    status: params.status,
    questionLog: shouldSaveQuestion ? params.maskedQuestion : null,
  });

  return {
    savedRawQuestion: shouldSaveQuestion,
    retentionDays,
  };
}

export function getPrivacyPolicySummary() {
  return {
    kidModeStorage: 'disabled (유아·어린이 모드는 질문 원문 및 개인정보를 일체 저장하지 않음)',
    piiMaskingTargets: ['이름', '연락처', '주민등록번호', '이메일', '학교/학번'],
    logRawQuestion: getEnv('LOG_RAW_QUESTION') === 'true',
    retentionDays: Number(getEnv('LOG_RETENTION_DAYS') || 7),
    activeLogCount: auditLogs.length,
  };
}
