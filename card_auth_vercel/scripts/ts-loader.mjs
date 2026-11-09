/**
 * ts-loader.mjs - 로컬 Node.js 실행 시 './foo.js' 상대 경로 import를 './foo.ts'로 매핑
 * (Vercel 서버리스 빌드 표준인 .js 확장자 import와 로컬 무설치 실행을 동시에 지원)
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && specifier.endsWith('.js')) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw err;
    }
  },
});

