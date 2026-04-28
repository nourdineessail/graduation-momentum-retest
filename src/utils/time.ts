export function minutesSince(date: Date): number {
  return (Date.now() - date.getTime()) / 60000;
}

export function secondsSince(date: Date): number {
  return (Date.now() - date.getTime()) / 1000;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
