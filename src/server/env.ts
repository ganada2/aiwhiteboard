export function getEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env && key in process.env) {
    return process.env[key];
  }
  return undefined;
}
