/** 积分：每消费 1 元积 1 分 */
export function pointsFor(totalFen) { return Math.floor(totalFen / 100); }
export function levelOf(points) {
  if (points >= 10000) return 'gold';
  if (points >= 3000) return 'silver';
  return 'bronze';
}
