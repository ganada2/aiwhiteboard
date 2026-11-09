import { useEffect, useState } from 'react';
import { ChalkboardWorkspace } from './components/ChalkboardWorkspace';
import { PromptInspectorModal } from './components/PromptInspectorModal';
import type {
  LearnAction,
  LearnMode,
  SolveApiPayload,
  VideoApiPayload,
} from './shared/schema';
import { restorePendingIapOrders, triggerAitHaptic } from './utils/aitBridge';
import { requestSolve, requestVideo } from './utils/apiClient';

export function App() {
  const [mode, setMode] = useState<LearnMode>('high');
  const [action, setAction] = useState<LearnAction>('solve');

  const [solvePayload, setSolvePayload] = useState<SolveApiPayload | null>(null);
  const [videoPayload, setVideoPayload] = useState<VideoApiPayload | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  // 앱 진입 시 IAP 미결 주문 복원만 수행하고, 칠판은 깨끗한 빈 메모 상태로 시작
  useEffect(() => {
    void restorePendingIapOrders();
  }, []);

  // 사용자가 칠판에 메모를 작성한 뒤 [✨ AI 설명하기] 버튼을 눌렀을 때만 1차 호출 (TASK=SOLVE)
  const handleExplainBoardContent = async (
    boardContent: string,
    overrideMode?: LearnMode,
    overrideAction?: LearnAction,
  ) => {
    const targetQuestion = boardContent.trim();
    if (!targetQuestion) return;

    const targetMode = overrideMode ?? mode;
    const targetAction = overrideAction ?? action;

    setIsSolving(true);
    setErrorMsg(null);
    // 새 설명 요청 시 기존 2차 호출 영상은 초기화 (비용 절약을 위해 재생 버튼 클릭 시에만 생성)
    setVideoPayload(null);

    try {
      const res = await requestSolve({
        mode: targetMode,
        action: targetAction,
        question: targetQuestion,
      });
      setSolvePayload(res);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : '칠판 메모를 바탕으로 설명을 생성하는 중 오류가 발생했습니다.',
      );
    } finally {
      setIsSolving(false);
    }
  };

  // 사용자가 슬라이드업 칠판 보드에서 [상세 설명 영상 재생]을 눌렀을 때만 2차 호출 (TASK=VIDEO)
  const handleRequestVideo = async () => {
    if (!solvePayload || solvePayload.solve.status !== 'ok') return;
    setIsGeneratingVideo(true);
    setErrorMsg(null);

    try {
      const res = await requestVideo({
        mode: solvePayload.solve.mode,
        solveResult: solvePayload.solve,
      });
      setVideoPayload(res);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : '상세 설명 영상을 생성하는 중 오류가 발생했습니다.',
      );
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  return (
    <>
      <ChalkboardWorkspace
        mode={mode}
        action={action}
        onChangeMode={(nextMode) => {
          triggerAitHaptic('tap');
          setMode(nextMode);
        }}
        onChangeAction={(nextAction) => {
          triggerAitHaptic('tap');
          setAction(nextAction);
        }}
        solvePayload={solvePayload}
        videoPayload={videoPayload}
        isSolving={isSolving}
        isGeneratingVideo={isGeneratingVideo}
        errorMsg={errorMsg}
        onExplainBoardContent={handleExplainBoardContent}
        onRequestVideo={handleRequestVideo}
        onOpenInspector={() => setInspectorOpen(true)}
      />

      {solvePayload && (
        <PromptInspectorModal
          isOpen={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          mode={mode}
          action={action}
          solvePayload={solvePayload}
          videoPayload={videoPayload}
        />
      )}
    </>
  );
}

export default App;
