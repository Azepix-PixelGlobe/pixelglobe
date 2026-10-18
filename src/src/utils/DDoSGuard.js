/*
 * Keeps short-lived hard bans for abusive websocket clients.
 *
 * This guard intentionally stays local to the process. The websocket rate
 * limiter already broadcasts its trigger to the other PixelPlanet instances,
 * while this map prevents repeated upgrade attempts from reaching this
 * instance during the ban window.
 */
class DDoSGuard {
  bans = new Map();

  constructor() {
    this.clearExpired = this.clearExpired.bind(this);
    this.cleaner = setInterval(this.clearExpired, 60 * 1000);
    this.cleaner.unref?.();
  }

  clearExpired() {
    const now = Date.now();
    for (const [ip, ban] of this.bans) {
      if (ban.until <= now) {
        this.bans.delete(ip);
      }
    }
  }

  ban(ip, blockTime, reason) {
    const until = Date.now() + Math.max(0, blockTime);
    const previous = this.bans.get(ip);
    if (!previous || previous.until < until) {
      this.bans.set(ip, { until, reason });
    }
  }

  banRemaining(ip) {
    const ban = this.bans.get(ip);
    if (!ban) {
      return 0;
    }

    const remaining = ban.until - Date.now();
    if (remaining <= 0) {
      this.bans.delete(ip);
      return 0;
    }
    return remaining;
  }
}

export default new DDoSGuard();