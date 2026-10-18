/*
 * Rate Limiter for multiple clients per instance,
 * Always has 1min burst time
 * Once triggered, always have to wait
 */
class MassRateLimiter {
  /*
   * Map<identifier:
   *   [
   *     time: absolute timestamp (if 1min in the future: trigger),
   *     triggered: boolean if limit is triggered,
   *   ]
   * >
   */
  triggers;
  /*
   * blockTime time a client is blocked once limit is triggered
   */
  blockTime;
  /*
   * budget: tetikleme icin gereken toplam "borc" (ms).
   * Varsayilan 60sn = dakikada ~60 birim. HTTP icin daha genis verilir,
   * cunku okul/isyeri/mobil NAT arkasinda onlarca oyuncu ayni IP'yi kullanir.
   */
  budget;
  /*
   * every instance should clean up in the same interval
   */
  static cleaners = [];
  static cleaningInterval = 0;

  constructor(blockTime, budget = 60000) {
    this.triggers = new Map();
    this.blockTime = blockTime;
    this.budget = budget;
    this.clearOld = this.clearOld.bind(this);
    MassRateLimiter.cleaners.push(this.clearOld);
  }

  destructor() {
    MassRateLimiter.cleaners.splice(
      MassRateLimiter.cleaners.indexOf(this.clearOld), 1,
    );
  }

  static runCleaners() {
    MassRateLimiter.cleaners.forEach((s) => s());
  }

  clearOld() {
    const now = Date.now();
    const { triggers } = this;
    [...triggers.keys()].forEach((identifier) => {
      const limiter = triggers.get(identifier);
      if (limiter && now > limiter[0]) {
        triggers.delete(identifier);
      }
    });
  }

  /**
   * tick the rate limit for one identifier
   * @param identifier
   * @param deltaTime by which to increase time
   * @param reason string describing the tick
   * @param onTrigger callback that gets called on trigger
   * @return boolean if triggered
   */
  tick(identifier, deltaTime, reason, onTrigger) {
    const limiter = this.triggers.get(identifier);
    const now = Date.now();
    if (limiter && limiter[0] > now) {
      if (limiter[1]) {
        return true;
      }
      limiter[0] += deltaTime;
      if (limiter[0] > now + this.budget) {
        limiter[1] = true;
        limiter[0] += this.blockTime;
        onTrigger(identifier, this.blockTime, reason);
        return true;
      }
    } else {
      this.triggers.set(
        identifier,
        [now + deltaTime, false],
      );
    }
    return false;
  }

  /**
   * check if triggered for an identifier
   * @param identifier
   */
  isTriggered(identifier) {
    const limiter = this.triggers.get(identifier);
    if (limiter?.[1] && limiter[0] > Date.now()) {
      return true;
    }
    return false;
  }

  /*
   * force trigger rate limit
   */
  forceTrigger(identifier, blockTime) {
    this.triggers.set(
      identifier,
      [Date.now() + blockTime, true],
    );
  }

  /*
   * add to deltaTime
   */
  add(identifier, deltaTime) {
    const limiter = this.triggers.get(identifier);
    if (limiter) {
      limiter[0] += deltaTime;
    } else {
      this.triggers.set(
        identifier,
        [Date.now() + deltaTime, false],
      );
    }
  }
}

MassRateLimiter.cleaningInterval = setInterval(
  MassRateLimiter.runCleaners, 60 * 1000,
);

export default MassRateLimiter;
