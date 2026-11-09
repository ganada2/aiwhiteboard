import assert from 'node:assert/strict';
import {
  parseStrictJson,
  validateSolveResponse,
  validateVideoResponse,
} from '../../shared/schema';
import { executeSolvePipeline, executeVideoPipeline } from '../aiService';
import { maskPersonalInformation } from '../privacy';
import { verifySolveExpressions, verifyVideoConsistency } from '../verifier';

async function runTests() {
  console.log('=== AI 칠판 서버 체크리스트 7대 검증 테스트 시작 ===\n');

  // 1. 명세서 4번 예시 (mode=kid, question="1+1=?", action=solve) 검증
  const kidSolve = await executeSolvePipeline({
    mode: 'kid',
    action: 'solve',
    question: '1+1=?',
  });
  assert.equal(kidSolve.solve.status, 'ok');
  assert.equal(kidSolve.solve.mode, 'kid');
  assert.equal(kidSolve.solve.topic, '1 더하기 1');
  assert.equal(kidSolve.solve.answer, '1 + 1 = 2');
  assert.equal(kidSolve.meta.allVerified, true);
  assert.equal(kidSolve.meta.privacySavedLog, false, 'kid 모드는 원문 로그를 저장하지 않아야 함');
  console.log('✅ [테스트 1] 명세서 기본 예시 (mode=kid, question="1+1=?") 및 kid 모드 미저장 검증 통과');

  // 2. 스키마 외 키 금지 검증 (체크리스트 #1)
  const invalidExtraKeyObj = {
    ...kidSolve.solve,
    extra_illegal_key: 'not allowed',
  };
  const schemaCheck = validateSolveResponse(invalidExtraKeyObj);
  assert.equal(schemaCheck.ok, false, '스키마에 없는 키가 있으면 실패해야 함');
  console.log('✅ [테스트 2] 스키마 외 키 거부 및 JSON 엄격 파싱 검증 통과');

  // 3. 수식 검증기(verify) 일치 및 불일치 감지 (체크리스트 #2)
  const validMath = verifySolveExpressions([
    { expr: '1+1', expected: '2' },
    { expr: '2**2 - 5*2 + 6', expected: '0' },
  ]);
  assert.equal(validMath.allPassed, true);

  const invalidMath = verifySolveExpressions([{ expr: '1+1', expected: '11' }]);
  assert.equal(invalidMath.allPassed, false, '틀린 계산 기대값은 불일치로 감지되어야 함');
  console.log('✅ [테스트 3] 서버 수식 계산기(verify) 일치/불일치 판별 검증 통과');

  // 4. status="clarify" 및 status="unsupported" 분기 검증 (체크리스트 #3)
  const clarifyRes = await executeSolvePipeline({
    mode: 'high',
    action: 'solve',
    question: '이거 풀어줘',
  });
  assert.equal(clarifyRes.solve.status, 'clarify');
  assert.ok(clarifyRes.solve.clarify_question);

  const unsupportedRes = await executeSolvePipeline({
    mode: 'high',
    action: 'solve',
    question: '로또번호 추천해줘',
  });
  assert.equal(unsupportedRes.solve.status, 'unsupported');
  console.log('✅ [테스트 4] status="clarify" 및 "unsupported" 분기 검증 통과');

  // 5. 2차 호출 (TASK=VIDEO) 생성 및 SOLVE 수식·숫자 일치 검증 (체크리스트 #4)
  const highSolve = await executeSolvePipeline({
    mode: 'high',
    action: 'solve',
    question: 'x^2 - 5x + 6 = 0',
  });
  const videoRes = await executeVideoPipeline({
    mode: 'high',
    solveResult: highSolve.solve,
  });
  const videoSchemaCheck = validateVideoResponse(videoRes.video);
  assert.equal(videoSchemaCheck.ok, true);
  assert.ok(
    videoRes.video.scenes.length >= 4 && videoRes.video.scenes.length <= 10,
  );
  const consistency = verifyVideoConsistency(highSolve.solve, videoRes.video);
  assert.equal(consistency.consistent, true);
  console.log('✅ [테스트 5] 2차 호출(TASK=VIDEO) 스키마 및 SOLVE 수식 일치 검증 통과');

  // 6. 개인정보(PII) 마스킹 검증 (체크리스트 #6)
  const piiSample = '내 이름은 김철수야 010-1234-5678 test@example.com 1+1=?';
  const masked = maskPersonalInformation(piiSample);
  assert.ok(!masked.maskedText.includes('김철수'));
  assert.ok(!masked.maskedText.includes('010-1234-5678'));
  assert.ok(!masked.maskedText.includes('test@example.com'));
  assert.equal(masked.maskedCount, 3);
  console.log('✅ [테스트 6] 개인정보(이름·연락처·이메일) 마스킹 검증 통과');

  // 7. JSON 코드블록 제거 파서 검증
  const fenced = '```json\n{"a": 1}\n```';
  const parsedFence = parseStrictJson(fenced);
  assert.equal(parsedFence.ok, true);
  console.log('✅ [테스트 7] JSON 파서 검증 통과\n');

  console.log('🎉 모든 AI 칠판 파이프라인 검증 테스트를 통과했습니다!');
}

runTests().catch((err) => {
  console.error('테스트 실패:', err);
  process.exit(1);
});
