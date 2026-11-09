import { evaluate, simplify, parse } from 'mathjs';
import type {
  SolveResponse,
  VerifyCheckDetail,
  VerifyItem,
  VideoResponse,
} from '../shared/schema';

/**
 * SymPy 문법(**, Rational, sqrt 등)을 mathjs 호환 문법으로 정규화
 */
function normalizeSympyToMathjs(expr: string): string {
  return expr
    .trim()
    .replace(/\*\*/g, '^')
    .replace(/Rational\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, '(($1)/($2))')
    .replace(/\\/g, '');
}

/**
 * 두 수식 또는 수치 문자열이 수학적으로 동치인지 비교
 */
function compareMathValues(exprRaw: string, expectedRaw: string): {
  passed: boolean;
  actual: string;
} {
  const exprNorm = normalizeSympyToMathjs(exprRaw);
  const expectedNorm = normalizeSympyToMathjs(expectedRaw);

  try {
    // 1. 수치 평가 비교
    const valExpr = evaluate(exprNorm);
    const valExpected = evaluate(expectedNorm);

    if (typeof valExpr === 'number' && typeof valExpected === 'number') {
      const diff = Math.abs(valExpr - valExpected);
      const passed = diff < 1e-7;
      const formattedActual = Number.isInteger(valExpr)
        ? String(valExpr)
        : Number(valExpr.toFixed(6)).toString();
      return { passed, actual: formattedActual };
    }

    if (Array.isArray(valExpr) || (valExpr && typeof valExpr === 'object')) {
      const actualStr = String(valExpr);
      return {
        passed: actualStr.replace(/\s+/g, '') === expectedNorm.replace(/\s+/g, ''),
        actual: actualStr,
      };
    }
  } catch {
    // 기호식이 포함된 경우 아래 기호 단순화 비교로 진행
  }

  try {
    // 2. 기호 대수식 단순화 비교 (예: "2*x + 3*x" vs "5*x", "(x-2)*(x-3)" vs "x^2 - 5*x + 6")
    const simplifiedExpr = simplify(parse(exprNorm)).toString();
    const simplifiedExpected = simplify(parse(expectedNorm)).toString();

    if (
      simplifiedExpr.replace(/\s+/g, '') === simplifiedExpected.replace(/\s+/g, '')
    ) {
      return { passed: true, actual: simplifiedExpr };
    }

    // 차(difference)가 0으로 단순화되는지 확인 + 다중 샘플 대입 검증
    const diffExpr = `(${exprNorm}) - (${expectedNorm})`;
    const simplifiedDiff = simplify(parse(diffExpr)).toString();
    if (simplifiedDiff === '0') {
      return { passed: true, actual: simplifiedExpr };
    }

    // 변수 x, y, n 등에 샘플 값 대입하여 항등식 여부 확인
    const samplePoints = [
      { x: 2, y: 3, n: 4, a: 2, b: 5 },
      { x: -1.5, y: 2.5, n: 7, a: 3, b: -2 },
      { x: 3.7, y: -0.8, n: 2, a: -1.2, b: 4.1 },
    ];
    let allSamplesMatch = true;
    for (const scope of samplePoints) {
      const v1 = evaluate(exprNorm, { ...scope });
      const v2 = evaluate(expectedNorm, { ...scope });
      if (typeof v1 !== 'number' || typeof v2 !== 'number' || Math.abs(v1 - v2) > 1e-6) {
        allSamplesMatch = false;
        break;
      }
    }
    if (allSamplesMatch) {
      return { passed: true, actual: simplifiedExpr };
    }

    return { passed: false, actual: simplifiedExpr };
  } catch (err) {
    // 단순 문자열 정규화 비교 폴백
    const cleanA = exprNorm.replace(/\s+/g, '');
    const cleanB = expectedNorm.replace(/\s+/g, '');
    return {
      passed: cleanA === cleanB,
      actual: err instanceof Error ? `평가오류(${err.message})` : cleanA,
    };
  }
}

/**
 * 체크리스트 #2: verify 배열의 모든 수식을 계산하여 expected와 비교
 */
export function verifySolveExpressions(verifyItems: VerifyItem[]): {
  allPassed: boolean;
  details: VerifyCheckDetail[];
  failureSummary: string | null;
} {
  if (!verifyItems || verifyItems.length === 0) {
    return { allPassed: true, details: [], failureSummary: null };
  }

  const details: VerifyCheckDetail[] = verifyItems.map((item) => {
    const { passed, actual } = compareMathValues(item.expr, item.expected);
    return {
      expr: item.expr,
      expected: item.expected,
      actual,
      passed,
      engine: 'mathjs',
    };
  });

  const failed = details.filter((d) => !d.passed);
  if (failed.length === 0) {
    return { allPassed: true, details, failureSummary: null };
  }

  const failureSummary = failed
    .map(
      (f) =>
        `수식 "${f.expr}"의 계산 결과는 "${f.actual}"인데 expected에는 "${f.expected}"라고 적혀 있습니다.`,
    )
    .join(' ');

  return {
    allPassed: false,
    details,
    failureSummary,
  };
}

/**
 * 텍스트에서 핵심 숫자 토큰 추출
 */
function extractNumbers(text: string): string[] {
  const matches = text.match(/-?\d+(?:\.\d+)?/g);
  return matches ? matches : [];
}

/**
 * 체크리스트 #4: VIDEO 장면의 판서(board_actions)가 SOLVE 결과의 핵심 답·수식 숫자와 일치하는지 검증
 */
export function verifyVideoConsistency(
  solveResult: SolveResponse,
  videoResult: VideoResponse,
): {
  consistent: boolean;
  notes: string[];
} {
  const notes: string[] = [];

  // SOLVE에 등장한 모든 숫자 집합
  const solveCorpus = [
    solveResult.topic,
    solveResult.answer,
    ...solveResult.steps.flatMap((s) => [...s.board, s.explain]),
    ...solveResult.verify.flatMap((v) => [v.expr, v.expected]),
    solveResult.check_question?.q ?? '',
    solveResult.check_question?.a ?? '',
  ].join(' ');

  const solveNumbers = new Set(extractNumbers(solveCorpus));
  // 장면 번호나 기본 인덱스(1~10)는 허용
  for (let i = 0; i <= 10; i++) {
    solveNumbers.add(String(i));
  }

  // VIDEO 판서 텍스트 모음
  const videoWriteTexts = videoResult.scenes.flatMap((sc) =>
    sc.board_actions
      .filter((a): a is Extract<typeof a, { type: 'write' }> => a.type === 'write')
      .map((a) => a.text),
  );

  const allWriteJoined = videoWriteTexts.join(' ');
  const answerNums = extractNumbers(solveResult.answer);

  // 1. 최종 답의 핵심 숫자가 영상 판서 또는 요약에 최소 1회 이상 포함되었는지 확인
  const closingAndBoard = `${allWriteJoined} ${videoResult.closing.summary}`;
  const missingAnswerNumbers = answerNums.filter(
    (num) => !closingAndBoard.includes(num),
  );

  if (missingAnswerNumbers.length > 0) {
    notes.push(
      `SOLVE 최종 답(${solveResult.answer})의 핵심 숫자 [${missingAnswerNumbers.join(', ')}]가 VIDEO 판서/요약에서 누락되었습니다.`,
    );
  }

  // 2. VIDEO 판서(write)에 SOLVE에 전혀 없던 새로운 큰 숫자가 임의로 등장했는지 확인
  const unexpectedNumbers: string[] = [];
  for (const writeText of videoWriteTexts) {
    const nums = extractNumbers(writeText);
    for (const n of nums) {
      if (!solveNumbers.has(n)) {
        unexpectedNumbers.push(n);
      }
    }
  }

  if (unexpectedNumbers.length > 0) {
    notes.push(
      `SOLVE 결과에 없던 숫자 [${Array.from(new Set(unexpectedNumbers)).join(', ')}]가 VIDEO 판서에 새로 등장했습니다.`,
    );
  }

  if (notes.length === 0) {
    return {
      consistent: true,
      notes: ['SOLVE 결과의 수식·숫자와 VIDEO 장면 판서가 정확히 일치합니다.'],
    };
  }

  return {
    consistent: false,
    notes,
  };
}
