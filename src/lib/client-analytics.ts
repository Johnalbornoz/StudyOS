/** Fire-and-forget client-side analytics call. Never pass answer text or other private content in `properties`. */
export function trackClientEvent(studentId: string, eventName: string, properties?: Record<string, unknown>): void {
  fetch('/api/analytics/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, eventName, properties }),
  }).catch(() => {});
}
