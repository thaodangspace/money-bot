export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export type RandomToken = (byteLength: number) => string;

export const randomToken: RandomToken = (byteLength) => {
  if (!Number.isInteger(byteLength) || byteLength < 1) throw new Error('invalid token length');
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};
