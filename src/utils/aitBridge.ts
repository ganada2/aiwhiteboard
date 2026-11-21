import {
  generateHapticFeedback,
  IAP,
  setClipboardText,
  share,
} from '@apps-in-toss/web-framework';

/**
 * Apps in Toss 햅틱 피드백 브릿지 호출 (일반 브라우저 환경에서는 navigator.vibrate 폴백)
 */
export function triggerAitHaptic(
  type: 'tap' | 'success' | 'warning' | 'error' = 'tap',
) {
  try {
    if (type === 'success') {
      generateHapticFeedback({ type: 'success' });
    } else if (type === 'warning') {
      generateHapticFeedback({ type: 'basicMedium' });
    } else if (type === 'error') {
      generateHapticFeedback({ type: 'error' });
    } else {
      generateHapticFeedback({ type: 'tickWeak' });
    }
  } catch {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(type === 'tap' ? 15 : [20, 40, 20]);
    }
  }
}

/**
 * Apps in Toss 공유 브릿지 호출 (폴백: 클립보드 복사)
 */
export async function shareChalkboardSummary(params: {
  topic: string;
  answer: string;
}): Promise<boolean> {
  const message = `[AI 칠판 - aiboard]\n📌 주제: ${params.topic}\n✅ 정답: ${params.answer}\n1타 강사의 단계별 판서 풀이를 확인해 보세요!`;

  try {
    await share({ message });
    triggerAitHaptic('success');
    return true;
  } catch {
    try {
      await setClipboardText(message);
      triggerAitHaptic('success');
      return true;
    } catch {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(message);
        return true;
      }
      return false;
    }
  }
}

/**
 * Apps in Toss 인앱결제(IAP) 미결 주문 복원 헬퍼 (toss/apps-in-toss-examples/in-app-payments 표준 패턴)
 */
export async function restorePendingIapOrders() {
  try {
    const pending = await IAP.getPendingOrders();
    if (pending && Array.isArray(pending.orders)) {
      for (const order of pending.orders) {
        await IAP.completeProductGrant({ params: { orderId: order.orderId } });
      }
    }
  } catch {
    // 로컬 웹 브라우저 개발 환경에서는 IAP 브릿지가 없으므로 무시
  }
}
