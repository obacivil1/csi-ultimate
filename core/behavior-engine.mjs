// AI human-like behavior mimicry engine
// Generates realistic mouse movements, scroll patterns, and timing

const MAX_STEPS = 120

// ── Bézier curve mouse movement ──────────────────────────────
function bezierPoint(t, p0, p1, p2, p3) {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

function generateHumanMousePath(fromX, fromY, toX, toY) {
  const dist = Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2)
  const steps = Math.min(Math.max(Math.floor(dist / 8), 15), MAX_STEPS)

  // Control points with random offsets for human-like curves
  const midX = (fromX + toX) / 2 + (Math.random() - 0.5) * dist * 0.4
  const midY = (fromY + toY) / 2 + (Math.random() - 0.5) * dist * 0.3

  const p0 = { x: fromX, y: fromY }
  const p1 = { x: fromX + (midX - fromX) * 0.3 + (Math.random() - 0.5) * 30, y: fromY + (midY - fromY) * 0.2 + (Math.random() - 0.5) * 20 }
  const p2 = { x: toX + (midX - toX) * 0.3 + (Math.random() - 0.5) * 30, y: toY + (midY - toY) * 0.2 + (Math.random() - 0.5) * 20 }
  const p3 = { x: toX, y: toY }

  const path = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const point = bezierPoint(t, p0, p1, p2, p3)
    // Add micro-jitter (human hand tremor)
    point.x += (Math.random() - 0.5) * 2
    point.y += (Math.random() - 0.5) * 2
    path.push(point)
  }
  return path
}

// ── Human-like scroll pattern ────────────────────────────────
function generateScrollPath(startY, endY) {
  const dist = Math.abs(endY - startY)
  const steps = Math.min(Math.max(Math.floor(dist / 30), 5), 40)
  const path = []
  let currentY = startY
  const direction = endY > startY ? 1 : -1

  for (let i = 0; i < steps; i++) {
    // Variable scroll amount - sometimes pause, sometimes burst
    const remaining = Math.abs(endY - currentY)
    const scrollAmount = direction * Math.min(
      remaining,
      (20 + Math.random() * 60) * (1 + Math.sin(i / steps * Math.PI) * 0.5)
    )
    currentY += scrollAmount
    if (Math.abs(endY - currentY) < 5) {
      currentY = endY
      path.push(currentY)
      break
    }
    path.push(currentY)
    // Random pause points
    if (Math.random() < 0.15) {
      path.push(currentY) // pause frame
    }
  }
  if (path[path.length - 1] !== endY) path.push(endY)
  return path
}

// ── Page interaction simulation ──────────────────────────────
export async function simulateHumanBehavior(page) {
  // Random scroll with pauses
  await humanScroll(page, 0, 200 + Math.random() * 400)
  await randomDelay(300, 800)
  await humanScroll(page, 200, 100 + Math.random() * 300)
  await randomDelay(200, 600)
  await humanScroll(page, 100, 400 + Math.random() * 600)
}

export async function humanScroll(page, startY, endY, speedMultiplier = 1) {
  try {
    const path = generateScrollPath(startY, endY)
    for (const y of path) {
      await page.evaluate((y) => window.scrollTo(0, y), y).catch(() => {})
      await randomDelay(15 * speedMultiplier, 40 * speedMultiplier)
    }
  } catch {}
}

export async function humanMouseMove(page, selector) {
  try {
    const box = await page.locator(selector).boundingBox()
    if (!box) return false

    const startX = 400 + Math.random() * 800
    const startY = 300 + Math.random() * 400
    const targetX = box.x + box.width / 2 + (Math.random() - 0.5) * 10
    const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * 10

    const path = generateHumanMousePath(startX, startY, targetX, targetY)
    for (const point of path) {
      await page.mouse.move(point.x, point.y)
      await randomDelay(2, 6)
    }
    // Hover briefly
    await randomDelay(80, 200)
    return true
  } catch { return false }
}

export async function humanClick(page, selector) {
  const moved = await humanMouseMove(page, selector)
  if (!moved) {
    try { await page.click(selector, { delay: 50 + Math.random() * 150 }) } catch {}
    return
  }
  await randomDelay(50, 150)
  try {
    await page.click(selector, { delay: 30 + Math.random() * 100 })
  } catch {}
}

export async function humanType(page, selector, text) {
  try {
    await page.click(selector, { delay: 40 + Math.random() * 120 })
    await randomDelay(100, 300)
    for (const char of text) {
      await page.keyboard.type(char, { delay: 40 + Math.random() * 120 })
      // Random pauses between words
      if (char === " " && Math.random() < 0.3) {
        await randomDelay(200, 500)
      }
    }
  } catch {}
}

// ── Random delay with realistic distribution ─────────────────
export function randomDelay(min, max) {
  // Use random distribution weighted toward shorter delays (human-like)
  const r = Math.random()
  const weighted = min + (max - min) * (r * r * 0.7 + r * 0.3)
  return new Promise(resolve => setTimeout(resolve, Math.floor(weighted)))
}

// ── Wait for page to "stabilize" (human perception simulation)
export async function waitForStabilization(page, minWait = 500) {
  await randomDelay(minWait, minWait + 2000)
  // Simulate reading/scanning the page
  if (Math.random() < 0.6) {
    await humanScroll(page, 0, Math.random() * 400)
  }
}

export default {
  generateHumanMousePath,
  generateScrollPath,
  simulateHumanBehavior,
  humanScroll,
  humanMouseMove,
  humanClick,
  humanType,
  randomDelay,
  waitForStabilization,
}
