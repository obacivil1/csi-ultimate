const sleep = (ms) => new Promise(r => setTimeout(r, ms))

export class TokenBucket {
  constructor(ratePerSec, burst) {
    this.rate = ratePerSec
    this.burst = burst
    this.tokens = burst
    this.last = Date.now()
  }

  async take() {
    const now = Date.now()
    const passed = ((now - this.last) / 1000) * this.rate
    this.tokens = Math.min(this.burst, this.tokens + passed)
    this.last = now
    let waited = 0
    while (this.tokens < 1) {
      const wait = Math.ceil(((1 - this.tokens) / this.rate) * 1000)
      await sleep(wait)
      waited += wait
      this.last = Date.now()
      this.tokens = Math.min(this.burst, this.tokens + (wait / 1000) * this.rate)
    }
    this.tokens -= 1
    return waited
  }
}