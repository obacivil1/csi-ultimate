// Professional anti-detection fingerprint engine
// Generates unique, realistic browser fingerprints per session
// Uses real device profiles from crowd-sourced data

// ── Real device profiles (crowd-sourced from real users) ────
const PROFILES = [
  // Windows 11 + Chrome 125
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    platform: "Win32", oscpu: "Windows NT 10.0", arch: "x86_64",
    vendor: "Google Inc.", vendorSub: "", productSub: "20030107",
    renderer: "ANGLE (Intel, Intel(R) UHD Graphics (0x0000A720) Direct3D11 vs_5_0 ps_5_0)",
    vendorWebGL: "Intel Inc.",
    canvasNoise: 0.0003, audioNoise: 0.0001,
    hardwareConcurrency: 8, deviceMemory: 8,
    maxTouchPoints: 0, screenWidth: 1920, screenHeight: 1080,
    colorDepth: 24, pixelDepth: 24,
    timezone: "Asia/Riyadh", locale: "en-SA", languages: ["en-SA", "en-US"],
    fonts: ["Arial", "Calibri", "Cambria", "Consolas", "Corbel", "Georgia", "Lucida Console", "Segoe UI", "Tahoma", "Times New Roman", "Verdana"],
    webdriver: false,
    plugins: ["Chrome PDF Plugin", "Chrome PDF Viewer", "Native Client"],
    touchSupport: false,
  },
  // Windows 10 + Chrome 124
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    platform: "Win32", oscpu: "Windows NT 10.0", arch: "x86_64",
    vendor: "Google Inc.", vendorSub: "", productSub: "20030107",
    renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002484) Direct3D11 vs_5_0 ps_5_0)",
    vendorWebGL: "NVIDIA Corporation",
    canvasNoise: 0.0002, audioNoise: 0.00015,
    hardwareConcurrency: 12, deviceMemory: 16,
    maxTouchPoints: 0, screenWidth: 1920, screenHeight: 1080,
    colorDepth: 24, pixelDepth: 24,
    timezone: "Asia/Riyadh", locale: "ar-SA", languages: ["ar-SA", "en-US"],
    fonts: ["Arial", "Calibri", "Cambria", "Consolas", "Corbel", "Segoe UI", "Tahoma", "Times New Roman"],
    webdriver: false,
    plugins: ["Chrome PDF Plugin", "Chrome PDF Viewer", "Native Client"],
    touchSupport: false,
  },
  // MacOS + Chrome 125
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    platform: "MacIntel", oscpu: "Intel Mac OS X 10.15.7", arch: "x86_64",
    vendor: "Google Inc.", vendorSub: "", productSub: "20030107",
    renderer: "ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)",
    vendorWebGL: "Apple Inc.",
    canvasNoise: 0.0004, audioNoise: 0.0002,
    hardwareConcurrency: 10, deviceMemory: 16,
    maxTouchPoints: 0, screenWidth: 2560, screenHeight: 1600,
    colorDepth: 30, pixelDepth: 30,
    timezone: "Asia/Riyadh", locale: "en-SA", languages: ["en-SA", "en-US", "ar-SA"],
    fonts: ["Arial", "Helvetica", "Lucida Grande", "Menlo", "Monaco", "San Francisco", "Tahoma", "Times New Roman", "Verdana"],
    webdriver: false,
    plugins: ["Chrome PDF Plugin", "Chrome PDF Viewer", "Native Client"],
    touchSupport: false,
  },
  // Windows 11 + Chrome 125 (4K)
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    platform: "Win32", oscpu: "Windows NT 10.0", arch: "x86_64",
    vendor: "Google Inc.", vendorSub: "", productSub: "20030107",
    renderer: "ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0)",
    vendorWebGL: "AMD",
    canvasNoise: 0.00025, audioNoise: 0.00012,
    hardwareConcurrency: 16, deviceMemory: 32,
    maxTouchPoints: 0, screenWidth: 3840, screenHeight: 2160,
    colorDepth: 24, pixelDepth: 24,
    timezone: "Asia/Riyadh", locale: "en-SA", languages: ["en-SA"],
    fonts: ["Arial", "Calibri", "Cambria", "Consolas", "Corbel", "Georgia", "Segoe UI", "Tahoma", "Times New Roman", "Verdana"],
    webdriver: false,
    plugins: ["Chrome PDF Plugin", "Chrome PDF Viewer", "Native Client"],
    touchSupport: false,
  },
  // Mobile Android + Chrome
  {
    ua: "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.147 Mobile Safari/537.36",
    platform: "Android", oscpu: "Linux armv8l", arch: "arm64",
    vendor: "Google Inc.", vendorSub: "", productSub: "20030107",
    renderer: "Adreno (Android, Qualcomm, Adreno 750, OpenGL ES 3.2)",
    vendorWebGL: "Qualcomm",
    canvasNoise: 0.00035, audioNoise: 0.00018,
    hardwareConcurrency: 8, deviceMemory: 8,
    maxTouchPoints: 5, screenWidth: 1080, screenHeight: 2340,
    colorDepth: 24, pixelDepth: 24,
    timezone: "Asia/Riyadh", locale: "ar-SA", languages: ["ar-SA", "en-US"],
    fonts: ["Droid Sans Mono", "Noto Naskh Arabic", "Noto Sans", "Roboto", "sans-serif"],
    webdriver: false,
    plugins: ["Chrome PDF Viewer"],
    touchSupport: true,
  },
  // Mobile iPhone + Safari
  {
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    platform: "iPhone", oscpu: "iOS 17.5", arch: "arm64",
    vendor: "Apple Inc.", vendorSub: "", productSub: "20030107",
    renderer: "Apple GPU (Apple, Apple A17 GPU, Metal)",
    vendorWebGL: "Apple Inc.",
    canvasNoise: 0.0005, audioNoise: 0.00025,
    hardwareConcurrency: 6, deviceMemory: 6,
    maxTouchPoints: 5, screenWidth: 390, screenHeight: 844,
    colorDepth: 30, pixelDepth: 30,
    timezone: "Asia/Riyadh", locale: "en-SA", languages: ["en-SA", "ar-SA"],
    fonts: ["American Typewriter", "Apple Color Emoji", "Helvetica Neue", "Menlo", "San Francisco", "Times New Roman"],
    webdriver: false,
    plugins: [],
    touchSupport: true,
  },
  // Windows 11 + Edge 125
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
    platform: "Win32", oscpu: "Windows NT 10.0", arch: "x86_64",
    vendor: "Microsoft Corporation", vendorSub: "", productSub: "20030107",
    renderer: "ANGLE (Intel, Intel(R) Iris Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0)",
    vendorWebGL: "Intel Inc.",
    canvasNoise: 0.00028, audioNoise: 0.00014,
    hardwareConcurrency: 8, deviceMemory: 16,
    maxTouchPoints: 0, screenWidth: 1920, screenHeight: 1080,
    colorDepth: 24, pixelDepth: 24,
    timezone: "Asia/Riyadh", locale: "en-SA", languages: ["en-SA", "en-US"],
    fonts: ["Arial", "Calibri", "Cambria", "Consolas", "Corbel", "Georgia", "Segoe UI", "Tahoma", "Times New Roman", "Verdana"],
    webdriver: false,
    plugins: ["Chrome PDF Plugin", "Chrome PDF Viewer", "Native Client", "Microsoft Edge PDF Plugin"],
    touchSupport: false,
  },
  // Windows 10 + Firefox 126
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
    platform: "Win32", oscpu: "Windows NT 10.0", arch: "x86_64",
    vendor: "", vendorSub: "", productSub: "20030107",
    renderer: "Intel(R) UHD Graphics -- Vulkan 1.3.0",
    vendorWebGL: "Intel",
    canvasNoise: 0.00032, audioNoise: 0.00016,
    hardwareConcurrency: 8, deviceMemory: 8,
    maxTouchPoints: 0, screenWidth: 1920, screenHeight: 1080,
    colorDepth: 24, pixelDepth: 24,
    timezone: "Asia/Riyadh", locale: "en-SA", languages: ["en-US", "en"],
    fonts: ["Arial", "Calibri", "Cambria", "Consolas", "Corbel", "DejaVu Sans", "Liberation Sans", "Segoe UI", "Tahoma"],
    webdriver: false,
    plugins: ["PDF Viewer"],
    touchSupport: false,
  },
]

// ── Browser context configuration generators ─────────────────

export function getRandomFingerprint() {
  const profile = PROFILES[Math.floor(Math.random() * PROFILES.length)]
  const viewport = getViewport(profile)
  return { profile, viewport }
}

function getViewport(profile) {
  const isMobile = profile.maxTouchPoints > 0
  return {
    width: profile.screenWidth,
    height: profile.screenHeight - (isMobile ? 80 : 100),
    deviceScaleFactor: profile.screenWidth > 1920 ? 2 : 1,
    isMobile,
    hasTouch: profile.touchSupport,
  }
}

export function buildContextOptions(fingerprint) {
  const { profile, viewport } = fingerprint
  return {
    viewport,
    userAgent: profile.ua,
    locale: profile.locale,
    timezoneId: profile.timezone,
    permissions: ["geolocation"],
    geolocation: { latitude: 24.7136, longitude: 46.6753 }, // Riyadh
    // Randomize viewport slightly to appear more natural
    viewport: {
      ...viewport,
      width: viewport.width + (Math.random() > 0.5 ? Math.floor(Math.random() * 40) : 0),
      height: viewport.height + (Math.random() > 0.5 ? Math.floor(Math.random() * 60) : 0),
    },
  }
}

// ── Stealth script injected before page load ─────────────────
export function buildStealthScript(profile, randomize = true) {
  const r = () => randomize ? (Math.random() * 0.001 + 0.0001) : 0.0003
  return `
  // Override navigator properties
  Object.defineProperties(navigator, {
    webdriver: { get: () => ${profile.webdriver} },
    hardwareConcurrency: { get: () => ${profile.hardwareConcurrency} },
    deviceMemory: { get: () => ${profile.deviceMemory} },
    maxTouchPoints: { get: () => ${profile.maxTouchPoints} },
    platform: { get: () => '${profile.platform}' },
    oscpu: { get: () => '${profile.oscpu}' },
    languages: { get: () => ${JSON.stringify(profile.languages)} },
    language: { get: () => '${profile.locale}' },
  })

  // Override plugins
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const arr = ${JSON.stringify(profile.plugins)}.map((name, i) => ({
        name, filename: name.replace(/\\s/g, '') + '.dll',
        length: 1, item: (i) => arr[i],
        namedItem: (n) => arr.find(p => p.name === n),
        [i]: { type: 'application/x-ppapi', suffixes: '', description: name }
      }))
      arr.length = ${profile.plugins.length}
      return arr
    }
  })

  // Override vendor
  Object.defineProperty(navigator, 'vendor', { get: () => '${profile.vendor}' })
  Object.defineProperty(navigator, 'vendorSub', { get: () => '${profile.vendorSub}' })
  Object.defineProperty(navigator, 'productSub', { get: () => '${profile.productSub}' })

  // WebGL spoofing
  const getParameter = WebGLRenderingContext.prototype.getParameter
  WebGLRenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return '${profile.vendorWebGL}'
    if (param === 37446) return '${profile.renderer}'
    return getParameter.call(this, param)
  }

  // Canvas noise
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL
  HTMLCanvasElement.prototype.toDataURL = function(type) {
    const ctx = this.getContext('2d')
    if (ctx) {
      const imageData = ctx.getImageData(0, 0, this.width, this.height)
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + Math.floor(Math.random() * 2)))
        imageData.data[i+1] = Math.max(0, Math.min(255, imageData.data[i+1] + Math.floor(Math.random() * 2)))
      }
      ctx.putImageData(imageData, 0, 0)
    }
    return origToDataURL.call(this, type)
  }

  const origToBlob = HTMLCanvasElement.prototype.toBlob
  HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
    const canvas = this
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + Math.floor(Math.random() * 2)))
      }
      ctx.putImageData(imageData, 0, 0)
    }
    origToBlob.call(canvas, callback, type, quality)
  }

  // AudioContext noise
  const origGetChannelData = AudioBuffer.prototype.getChannelData
  AudioBuffer.prototype.getChannelData = function(channel) {
    const data = origGetChannelData.call(this, channel)
    for (let i = 0; i < data.length; i += 100) {
      data[i] += (Math.random() - 0.5) * ${r()}
    }
    return data
  }

  // WebRTC disable
  if (window.RTCPeerConnection) {
    const origCreateDataChannel = RTCPeerConnection.prototype.createDataChannel
    RTCPeerConnection.prototype.createDataChannel = function() {
      return null
    }
  }

  // Color depth spoofing
  Object.defineProperty(screen, 'colorDepth', { get: () => ${profile.colorDepth} })
  Object.defineProperty(screen, 'pixelDepth', { get: () => ${profile.pixelDepth} })

  // Performance timing spoofing (add noise)
  if (window.performance && window.performance.timing) {
    const origTiming = window.performance.timing
    Object.defineProperty(window.performance, 'timing', {
      get: () => ({
        ...origTiming,
        navigationStart: origTiming.navigationStart + Math.floor(Math.random() * 50),
        fetchStart: origTiming.fetchStart + Math.floor(Math.random() * 30),
        domainLookupStart: origTiming.domainLookupStart + Math.floor(Math.random() * 20),
        connectStart: origTiming.connectStart + Math.floor(Math.random() * 15),
      })
    })
  }
  `
}

// ── Per-session unique fingerprint ──────────────────────────
let sessionFingerprint = null

export function initSessionFingerprint() {
  sessionFingerprint = getRandomFingerprint()
  return sessionFingerprint
}

export function rotateFingerprint() {
  sessionFingerprint = getRandomFingerprint()
  return sessionFingerprint
}

export function getSessionFingerprint() {
  if (!sessionFingerprint) initSessionFingerprint()
  return sessionFingerprint
}

export { PROFILES }
