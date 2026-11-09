import React from 'react';
import katex from 'katex';

interface MathTextProps {
  text: string;
  highlights?: string[];
  className?: string;
}

/**
 * KaTeX 호환 수식($...$ 또는 \frac, \therefore 등)과 강조어(highlight)를 함께 렌더링하는 컴포넌트
 */
export const MathText: React.FC<MathTextProps> = ({
  text,
  highlights = [],
  className = '',
}) => {
  if (!text) return null;

  // $...$ 수식 블록 분리, 만약 $가 없는데 LaTeX 명령어(\frac, \times, \therefore, \sqrt 등)가 있으면 수식 부분 변환
  const hasExplicitDollar = text.includes('$');
  const normalizedText =
    !hasExplicitDollar &&
    /(\\frac|\\times|\\div|\\therefore|\\alpha|\\beta|\\sqrt|\\cdot|\^)/.test(text)
      ? `$${text}$`
      : text;

  const segments = normalizedText.split(/(\$[^$]+\$)/g);

  const highlightTextSegment = (plain: string, keyPrefix: string) => {
    const validHighlights = highlights
      .map((h) => h.replace(/\$/g, '').trim())
      .filter((h) => h.length > 0);

    if (validHighlights.length === 0) {
      return <span key={keyPrefix}>{plain}</span>;
    }

    const escaped = validHighlights.map((h) =>
      h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = plain.split(regex);

    return (
      <React.Fragment key={keyPrefix}>
        {parts.map((part, idx) => {
          const isMatch = validHighlights.some(
            (h) => h.toLowerCase() === part.toLowerCase(),
          );
          return isMatch ? (
            <mark
              key={`${keyPrefix}_${idx}`}
              className="bg-amber-300/30 text-amber-200 px-1.5 py-0.5 rounded border-b-2 border-amber-300 font-semibold"
            >
              {part}
            </mark>
          ) : (
            <span key={`${keyPrefix}_${idx}`}>{part}</span>
          );
        })}
      </React.Fragment>
    );
  };

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.startsWith('$') && seg.endsWith('$') && seg.length > 2) {
          const latex = seg.slice(1, -1);
          const isHighlightedLatex = highlights.some((h) => {
            const cleanH = h.replace(/\$/g, '').trim();
            return cleanH.length > 0 && latex.includes(cleanH);
          });
          try {
            const html = katex.renderToString(latex, {
              throwOnError: false,
              displayMode: false,
            });
            return (
              <span
                key={`math_${i}`}
                className={
                  isHighlightedLatex
                    ? 'inline-block bg-amber-300/25 text-amber-200 px-1.5 py-0.5 rounded border-b-2 border-amber-300 mx-0.5'
                    : 'inline-block mx-0.5'
                }
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          } catch {
            return <span key={`math_fallback_${i}`}>{latex}</span>;
          }
        }
        return highlightTextSegment(seg, `txt_${i}`);
      })}
    </span>
  );
};
