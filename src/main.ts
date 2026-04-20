import './style.css'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { toJpeg } from 'html-to-image'

type Page = 'intro' | 'setup' | 'calibration' | 'performance' | 'results' | 'close'

const PROJECT_TITLE = 'EMBODIED XX0 beta'
const RECIPIENT_EMAIL = 'mail.francescopi@gmail.com'

const SCANNER_SPEED_M_PER_HOUR = 883
const SCANNER_SPEED_M_PER_SECOND = SCANNER_SPEED_M_PER_HOUR / 3600

type RelativeTimeMs = number | ''

type TheoreticalStep = {
  index: number
  absoluteTimeMs: number
  relativeTimeMs: number
  matched: boolean
}

type GpsPoint = {
  lat: number
  lng: number
  acc: number
  absoluteTimeMs: number
  relativeTimeMs: RelativeTimeMs
}

type ShareNavigator = Navigator & {
  canShare?: (data?: { files?: File[] }) => boolean
}

type AppState = {
  page: Page
  consentAccepted: boolean
  stepLengthCm: string
  footLengthCm: string
  alternativeMovementParameters: string
  calculatedIntervalSec: number | null
  calculatedIntervalMs: number | null

  motionEnabled: boolean
  gpsEnabled: boolean
  gpsDenied: boolean
  calibrationRunning: boolean
  sessionRunning: boolean

  sensitivity: number
  peakThreshold: number
  refractoryMs: number
  motionSource: string
  motionSignal: number
  calibrationDetectedSteps: number

  elapsedTime: string
  theoreticalSteps: number
  detectedSteps: number
  cumulativeDriftMs: number
  currentMisalignmentMs: number
  distanceMeters: number
  gpsPoints: number
}

const state: AppState = {
  page: 'intro',
  consentAccepted: false,
  stepLengthCm: '',
  footLengthCm: '',
  alternativeMovementParameters: '',
  calculatedIntervalSec: null,
  calculatedIntervalMs: null,

  motionEnabled: false,
  gpsEnabled: false,
  gpsDenied: false,
  calibrationRunning: false,
  sessionRunning: false,

  sensitivity: 6,
  peakThreshold: 0.98,
  refractoryMs: 783,
  motionSource: 'none',
  motionSignal: 0,
  calibrationDetectedSteps: 0,

  elapsedTime: '0.0 s',
  theoreticalSteps: 0,
  detectedSteps: 0,
  cumulativeDriftMs: 0,
  currentMisalignmentMs: 0,
  distanceMeters: 0,
  gpsPoints: 0,
}

let startTime: number | null = null
let stopTime: number | null = null
let liveTimer: number | null = null
let theoreticalStepTimeout: number | null = null
let audioContext: AudioContext | null = null

let gpsWatchId: number | null = null
let latestGps: GpsPoint | null = null

let lastDetectedStepTime = 0
let previousSignal = 0
let smoothedSignal = 0
let gravityBaseline = 9.81
let theoreticalStepIndex = 0

let resultsMap: L.Map | null = null
let resultsPolyline: L.Polyline | null = null
let resultsStartMarker: L.CircleMarker | null = null
let resultsEndMarker: L.CircleMarker | null = null

const theoreticalStepsStore: TheoreticalStep[] = []
const gpsTrack: GpsPoint[] = []

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function csvEscape(value: string | number | boolean | null | undefined) {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function safeIsoFilenamePart() {
  return new Date().toISOString().replaceAll(':', '-')
}

function mapSensitivity(value: number) {
  const threshold = 1.8 - ((value - 1) / 9) * 1.45
  const refractory = Math.round(1150 - ((value - 1) / 9) * 650)
  return { threshold, refractory }
}

function applySensitivity(value: number) {
  state.sensitivity = value
  const mapped = mapSensitivity(value)
  state.peakThreshold = mapped.threshold
  state.refractoryMs = mapped.refractory
}

applySensitivity(state.sensitivity)

function formatElapsed(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`
}

function getElapsedTimeMs() {
  if (state.sessionRunning && startTime !== null) return Date.now() - startTime
  if (!state.sessionRunning && startTime !== null && stopTime !== null) return stopTime - startTime
  return 0
}

function resetSignalState() {
  lastDetectedStepTime = 0
  previousSignal = 0
  smoothedSignal = 0
  gravityBaseline = 9.81
  state.motionSignal = 0
  state.motionSource = 'none'
}

function resetCalibrationData() {
  state.calibrationDetectedSteps = 0
  resetSignalState()
}

function resetSessionData() {
  startTime = null
  stopTime = null
  theoreticalStepIndex = 0

  state.elapsedTime = '0.0 s'
  state.theoreticalSteps = 0
  state.detectedSteps = 0
  state.currentMisalignmentMs = 0
  state.cumulativeDriftMs = 0
  state.distanceMeters = 0
  state.gpsPoints = 0

  latestGps = null
  gpsTrack.length = 0
  theoreticalStepsStore.length = 0

  resetSignalState()
}

function clearSessionTimers() {
  if (liveTimer !== null) {
    window.clearInterval(liveTimer)
    liveTimer = null
  }
  if (theoreticalStepTimeout !== null) {
    window.clearTimeout(theoreticalStepTimeout)
    theoreticalStepTimeout = null
  }
}

function stopGpsWatch() {
  if (gpsWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(gpsWatchId)
    gpsWatchId = null
  }
}

function destroyResultsMap() {
  if (resultsMap) {
    resultsMap.remove()
    resultsMap = null
  }
  resultsPolyline = null
  resultsStartMarker = null
  resultsEndMarker = null
}

function resetAllState() {
  clearSessionTimers()
  stopGpsWatch()
  destroyResultsMap()

  state.page = 'intro'
  state.consentAccepted = false
  state.stepLengthCm = ''
  state.footLengthCm = ''
  state.alternativeMovementParameters = ''
  state.calculatedIntervalSec = null
  state.calculatedIntervalMs = null

  state.motionEnabled = false
  state.gpsEnabled = false
  state.gpsDenied = false
  state.calibrationRunning = false
  state.sessionRunning = false

  applySensitivity(6)

  resetCalibrationData()
  resetSessionData()
}

function playBeep() {
  if (!audioContext) return

  const now = audioContext.currentTime
  const oscillator1 = audioContext.createOscillator()
  const oscillator2 = audioContext.createOscillator()
  const gainNode = audioContext.createGain()

  oscillator1.type = 'square'
  oscillator1.frequency.setValueAtTime(1400, now)

  oscillator2.type = 'triangle'
  oscillator2.frequency.setValueAtTime(950, now)

  gainNode.gain.setValueAtTime(0.0001, now)
  gainNode.gain.exponentialRampToValueAtTime(0.45, now + 0.01)
  gainNode.gain.exponentialRampToValueAtTime(0.22, now + 0.07)
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.2)

  oscillator1.connect(gainNode)
  oscillator2.connect(gainNode)
  gainNode.connect(audioContext.destination)

  oscillator1.start(now)
  oscillator2.start(now)
  oscillator1.stop(now + 0.2)
  oscillator2.stop(now + 0.2)
}

function getMotionValue(event: DeviceMotionEvent) {
  const acc = event.acceleration

  if (acc && acc.x != null && acc.y != null && acc.z != null) {
    state.motionSource = 'acceleration'
    const x = acc.x ?? 0
    const y = acc.y ?? 0
    const z = acc.z ?? 0
    return Math.sqrt(x * x + y * y + z * z)
  }

  const accG = event.accelerationIncludingGravity
  if (accG && accG.x != null && accG.y != null && accG.z != null) {
    state.motionSource = 'accelerationIncludingGravity'
    const x = accG.x ?? 0
    const y = accG.y ?? 0
    const z = accG.z ?? 0
    const magnitude = Math.sqrt(x * x + y * y + z * z)

    gravityBaseline = 0.03 * magnitude + (1 - 0.03) * gravityBaseline
    return Math.abs(magnitude - gravityBaseline)
  }

  state.motionSource = 'none'
  return null
}

function findBestUnmatchedTheoreticalStep(now: number) {
  let best: TheoreticalStep | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const step of theoreticalStepsStore) {
    if (step.matched) continue
    const distance = Math.abs(now - step.absoluteTimeMs)
    if (distance < bestDistance) {
      best = step
      bestDistance = distance
    }
  }

  return best
}

function updatePerformanceMetricsOnly() {
  const elapsed = document.querySelector<HTMLElement>('[data-metric="elapsed-time"]')
  if (elapsed) elapsed.textContent = state.elapsedTime

  const theoretical = document.querySelector<HTMLElement>('[data-metric="theoretical-steps"]')
  if (theoretical) theoretical.textContent = String(state.theoreticalSteps)

  const detected = document.querySelector<HTMLElement>('[data-metric="detected-steps"]')
  if (detected) detected.textContent = String(state.detectedSteps)

  const misalignment = document.querySelector<HTMLElement>('[data-metric="current-misalignment"]')
  if (misalignment) misalignment.textContent = `${Math.round(state.currentMisalignmentMs)} ms`

  const drift = document.querySelector<HTMLElement>('[data-metric="cumulative-drift"]')
  if (drift) drift.textContent = `${Math.round(state.cumulativeDriftMs)} ms`

  const distance = document.querySelector<HTMLElement>('[data-metric="distance"]')
  if (distance) distance.textContent = `${state.distanceMeters.toFixed(2)} m`
}

function refreshPerformanceOrRender() {
  if (state.page === 'performance' && state.sessionRunning) {
    updatePerformanceMetricsOnly()
  } else {
    renderApp()
  }
}

function registerDetectedStep(now: number) {
  state.detectedSteps += 1

  const best = findBestUnmatchedTheoreticalStep(now)
  if (best) {
    best.matched = true
    const misalignment = now - best.absoluteTimeMs
    state.currentMisalignmentMs = misalignment
    state.cumulativeDriftMs += misalignment
  }

  refreshPerformanceOrRender()
}

function handleMotionEvent(event: DeviceMotionEvent) {
  const rawValue = getMotionValue(event)
  if (rawValue == null) return

  smoothedSignal = 0.35 * rawValue + (1 - 0.35) * smoothedSignal
  state.motionSignal = smoothedSignal

  const now = Date.now()
  const enoughTimePassed = now - lastDetectedStepTime > state.refractoryMs
  const crossedUp = previousSignal <= state.peakThreshold && state.motionSignal > state.peakThreshold

  if (state.calibrationRunning && crossedUp && enoughTimePassed) {
    lastDetectedStepTime = now
    state.calibrationDetectedSteps += 1
    renderApp()
  }

  if (state.sessionRunning && crossedUp && enoughTimePassed) {
    lastDetectedStepTime = now
    registerDetectedStep(now)
  }

  previousSignal = state.motionSignal
}

async function enableMotion() {
  try {
    const MotionEventWithPermission = DeviceMotionEvent as typeof DeviceMotionEvent & {
      requestPermission?: () => Promise<'granted' | 'denied'>
    }

    if (
      typeof MotionEventWithPermission !== 'undefined' &&
      typeof MotionEventWithPermission.requestPermission === 'function'
    ) {
      const permission = await MotionEventWithPermission.requestPermission()
      if (permission !== 'granted') {
        alert('Motion permission denied.')
        return
      }
    }

    window.removeEventListener('devicemotion', handleMotionEvent)
    window.addEventListener('devicemotion', handleMotionEvent)

    state.motionEnabled = true
    renderApp()
  } catch (error) {
    console.error(error)
    alert('Unable to enable motion on this device/browser.')
  }
}

function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const R = 6371000

  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function buildGpsPoint(position: GeolocationPosition): GpsPoint {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    acc: position.coords.accuracy,
    absoluteTimeMs: position.timestamp,
    relativeTimeMs: startTime !== null ? position.timestamp - startTime : '',
  }
}

function shouldUseGpsPoint(point: GpsPoint) {
  return Number.isFinite(point.acc) && point.acc > 0 && point.acc <= 100
}

function addGpsPoint(position: GeolocationPosition) {
  const point = buildGpsPoint(position)
  latestGps = point

  if (!shouldUseGpsPoint(point)) {
    refreshPerformanceOrRender()
    return
  }

  if (gpsTrack.length === 0) {
    gpsTrack.push(point)
    state.gpsPoints = gpsTrack.length
    refreshPerformanceOrRender()
    return
  }

  const prev = gpsTrack[gpsTrack.length - 1]
  const segmentDistance = haversineDistanceMeters(prev.lat, prev.lng, point.lat, point.lng)

  const timeDiffSec =
    point.absoluteTimeMs > prev.absoluteTimeMs
      ? (point.absoluteTimeMs - prev.absoluteTimeMs) / 1000
      : 0

  const plausibleSpeedMps =
    timeDiffSec > 0 ? segmentDistance / timeDiffSec : Number.POSITIVE_INFINITY

  if (plausibleSpeedMps <= 3.5) {
    state.distanceMeters += segmentDistance
    gpsTrack.push(point)
    state.gpsPoints = gpsTrack.length
  }

  refreshPerformanceOrRender()
}

function enableGps() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported on this device/browser.')
    return
  }

  state.gpsDenied = false

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const point = buildGpsPoint(position)
      latestGps = point
      state.gpsEnabled = true

      if (shouldUseGpsPoint(point) && gpsTrack.length === 0) {
        gpsTrack.push(point)
        state.gpsPoints = gpsTrack.length
      }

      renderApp()
    },
    (error) => {
      console.error(error)
      state.gpsEnabled = false
      state.gpsDenied = true
      renderApp()
      alert('GPS denied or unavailable.')
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000,
    },
  )
}

function startGpsWatch() {
  if (!state.gpsEnabled || !navigator.geolocation) return

  stopGpsWatch()

  gpsWatchId = navigator.geolocation.watchPosition(
    (position) => {
      addGpsPoint(position)
    },
    (error) => {
      console.error(error)
      state.gpsEnabled = false
      state.gpsDenied = true
      stopGpsWatch()
      renderApp()
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000,
    },
  )
}

function startCalibration() {
  if (!state.motionEnabled || state.sessionRunning) return
  state.calibrationRunning = true
  resetCalibrationData()
  renderApp()
}

function resetCalibration() {
  state.calibrationRunning = false
  resetCalibrationData()
  renderApp()
}

function pushTheoreticalStep(tsAbsolute: number) {
  state.theoreticalSteps += 1

  theoreticalStepsStore.push({
    index: state.theoreticalSteps,
    absoluteTimeMs: tsAbsolute,
    relativeTimeMs: startTime !== null ? tsAbsolute - startTime : 0,
    matched: false,
  })

  refreshPerformanceOrRender()
}

function scheduleNextTheoreticalStep() {
  if (!state.sessionRunning || startTime === null || state.calculatedIntervalMs === null) return

  const interval = state.calculatedIntervalMs
  const targetTime = startTime + theoreticalStepIndex * interval
  const delay = Math.max(0, targetTime - Date.now())

  theoreticalStepTimeout = window.setTimeout(() => {
    if (!state.sessionRunning || startTime === null) return

    pushTheoreticalStep(targetTime)
    playBeep()

    theoreticalStepIndex += 1
    scheduleNextTheoreticalStep()
  }, delay)
}

async function ensureAudioContext() {
  if (!audioContext) {
    const AudioCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

    if (AudioCtor) {
      audioContext = new AudioCtor()
    }
  }

  if (audioContext?.state === 'suspended') {
    await audioContext.resume()
  }
}

async function startSession() {
  if (!state.calculatedIntervalMs || !state.motionEnabled || state.sessionRunning) return

  state.calibrationRunning = false
  clearSessionTimers()
  resetSessionData()

  state.sessionRunning = true
  startTime = Date.now()
  stopTime = null
  theoreticalStepIndex = 0

  await ensureAudioContext()

  scheduleNextTheoreticalStep()

  liveTimer = window.setInterval(() => {
    state.elapsedTime = formatElapsed(getElapsedTimeMs())
    refreshPerformanceOrRender()
  }, 100)

  startGpsWatch()
  renderApp()
}

function stopSession() {
  if (!state.sessionRunning) return

  state.sessionRunning = false
  stopTime = Date.now()

  clearSessionTimers()
  stopGpsWatch()

  state.elapsedTime = formatElapsed(getElapsedTimeMs())
  state.page = 'results'
  renderApp()
}

function confirmLeaveDuringSession() {
  if (!state.sessionRunning) return true
  alert('Please end the current session before leaving this page.')
  return false
}

function formatCoordinate(value: number) {
  return value.toFixed(6)
}

function buildCsvRows() {
  const rows: string[][] = []

  rows.push(['section', 'field', 'value'])

  rows.push(['summary', 'project', PROJECT_TITLE])
  rows.push(['summary', 'exportedAtIso', new Date().toISOString()])
  rows.push(['summary', 'consentAccepted', String(state.consentAccepted)])
  rows.push(['summary', 'stepLengthCm', state.stepLengthCm])
  rows.push(['summary', 'footLengthCm', state.footLengthCm])
  rows.push(['summary', 'alternativeMovementParameters', state.alternativeMovementParameters])
  rows.push(['summary', 'calculatedIntervalSec', state.calculatedIntervalSec ?? ''])
  rows.push(['summary', 'calculatedIntervalMs', state.calculatedIntervalMs ?? ''])
  rows.push(['summary', 'sensitivity', state.sensitivity])
  rows.push(['summary', 'peakThreshold', state.peakThreshold])
  rows.push(['summary', 'refractoryMs', state.refractoryMs])
  rows.push(['summary', 'elapsedTime', state.elapsedTime])
  rows.push(['summary', 'theoreticalSteps', state.theoreticalSteps])
  rows.push(['summary', 'detectedSteps', state.detectedSteps])
  rows.push(['summary', 'cumulativeDriftMs', state.cumulativeDriftMs])
  rows.push(['summary', 'currentMisalignmentMs', state.currentMisalignmentMs])
  rows.push(['summary', 'distanceMeters', state.distanceMeters])
  rows.push(['summary', 'gpsPoints', state.gpsPoints])

  rows.push([])
  rows.push(['gpsTrack', 'index', 'lat', 'lng', 'accuracyMeters', 'absoluteTimeMs', 'relativeTimeMs'])

  gpsTrack.forEach((point, index) => {
    rows.push([
      'gpsTrack',
      String(index + 1),
      String(point.lat),
      String(point.lng),
      String(point.acc),
      String(point.absoluteTimeMs),
      String(point.relativeTimeMs),
    ])
  })

  rows.push([])
  rows.push(['theoreticalSteps', 'index', 'absoluteTimeMs', 'relativeTimeMs', 'matched'])

  theoreticalStepsStore.forEach((step) => {
    rows.push([
      'theoreticalSteps',
      String(step.index),
      String(step.absoluteTimeMs),
      String(step.relativeTimeMs),
      String(step.matched),
    ])
  })

  return rows
}

function buildCsvString() {
  return buildCsvRows()
    .map((row) => row.map((cell) => csvEscape(cell)).join(','))
    .join('\n')
}

function buildCsvFile() {
  const csv = buildCsvString()
  return new File([csv], `embodied-xx0-beta-session-${safeIsoFilenamePart()}.csv`, {
    type: 'text/csv;charset=utf-8;',
  })
}

function buildGpxString() {
  const trackPoints = gpsTrack
    .map((point) => {
      const isoTime = new Date(point.absoluteTimeMs).toISOString()
      return `
      <trkpt lat="${point.lat}" lon="${point.lng}">
        <time>${isoTime}</time>
        <hdop>${point.acc}</hdop>
      </trkpt>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${PROJECT_TITLE}" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${PROJECT_TITLE}</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>${PROJECT_TITLE} Session Track</name>
    <trkseg>${trackPoints}
    </trkseg>
  </trk>
</gpx>`
}

function buildGpxFile() {
  const gpx = buildGpxString()
  return new File([gpx], `embodied-xx0-beta-track-${safeIsoFilenamePart()}.gpx`, {
    type: 'application/gpx+xml',
  })
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function buildFallbackRouteSvg() {
  if (gpsTrack.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
      <rect width="100%" height="100%" fill="#ffffff"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="32" fill="#555">
        No GPS trace available
      </text>
    </svg>`
  }

  const width = 1200
  const height = 800
  const padding = 80

  const lats = gpsTrack.map((p) => p.lat)
  const lngs = gpsTrack.map((p) => p.lng)

  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)

  const latRange = Math.max(maxLat - minLat, 0.00001)
  const lngRange = Math.max(maxLng - minLng, 0.00001)

  const points = gpsTrack.map((point) => {
    const x = padding + ((point.lng - minLng) / lngRange) * (width - padding * 2)
    const y = height - padding - ((point.lat - minLat) / latRange) * (height - padding * 2)
    return { x, y }
  })

  const polyline = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
  const start = points[0]
  const end = points[points.length - 1]

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <polyline points="${polyline}" fill="none" stroke="#1f1b16" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${start.x}" cy="${start.y}" r="16" fill="#2b7a3d"/>
    <circle cx="${end.x}" cy="${end.y}" r="16" fill="#8f2d2d"/>
    <text x="60" y="70" font-family="Arial, sans-serif" font-size="28" fill="#1f1b16">${PROJECT_TITLE}</text>
  </svg>`
}

async function svgToJpegFile(svg: string, filename: string) {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const svgUrl = URL.createObjectURL(svgBlob)

  try {
    const image = new Image()
    image.decoding = 'async'

    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Unable to render SVG image.'))
    })

    image.src = svgUrl
    await loaded

    const canvas = document.createElement('canvas')
    canvas.width = image.width || 1200
    canvas.height = image.height || 800

    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas context not available.')

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.92)
    })

    if (!blob) throw new Error('Unable to create JPEG blob.')
    return new File([blob], filename, { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}

async function buildMapJpegFile() {
  const filename = `embodied-xx0-beta-map-${safeIsoFilenamePart()}.jpg`
  const mapElement = document.querySelector<HTMLElement>('#results-map')

  if (mapElement) {
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 900))
      const dataUrl = await toJpeg(mapElement, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      })
      const response = await fetch(dataUrl)
      const blob = await response.blob()
      return new File([blob], filename, { type: 'image/jpeg' })
    } catch (error) {
      console.warn('Live map JPEG export failed, using fallback route image.', error)
    }
  }

  return svgToJpegFile(buildFallbackRouteSvg(), filename)
}

async function downloadAllSessionFiles() {
  const csvFile = buildCsvFile()
  downloadFile(csvFile)

  if (gpsTrack.length > 0) {
    const gpxFile = buildGpxFile()
    downloadFile(gpxFile)
  }

  const jpegFile = await buildMapJpegFile()
  downloadFile(jpegFile)
}

async function sendSessionData() {
  const files: File[] = [buildCsvFile()]

  if (gpsTrack.length > 0) {
    files.push(buildGpxFile())
  }

  files.push(await buildMapJpegFile())

  const shareNavigator = navigator as ShareNavigator

  if (shareNavigator.share && shareNavigator.canShare?.({ files })) {
    try {
      await shareNavigator.share({
        title: PROJECT_TITLE,
        text: 'Session files',
        files,
      })
      return
    } catch (error) {
      console.error(error)
    }
  }

  alert('This browser cannot send file attachments directly. The files will now be downloaded instead.')
  await downloadAllSessionFiles()
}

function deleteSessionData() {
  const confirmed = window.confirm('Delete all current session data?')
  if (!confirmed) return

  state.page = 'intro'
  state.consentAccepted = false
  state.stepLengthCm = ''
  state.footLengthCm = ''
  state.alternativeMovementParameters = ''
  state.calculatedIntervalSec = null
  state.calculatedIntervalMs = null
  state.calibrationRunning = false
  state.sessionRunning = false
  state.gpsEnabled = false
  state.gpsDenied = false
  state.motionEnabled = false

  clearSessionTimers()
  stopGpsWatch()
  destroyResultsMap()
  resetCalibrationData()
  resetSessionData()

  renderApp()
}

function initOrUpdateResultsMap() {
  const mapContainer = document.querySelector<HTMLDivElement>('#results-map')
  if (!mapContainer) return

  if (!resultsMap) {
    resultsMap = L.map(mapContainer, {
      zoomControl: true,
      attributionControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      crossOrigin: true,
      maxZoom: 19,
    }).addTo(resultsMap)
  }

  if (resultsPolyline) {
    resultsPolyline.remove()
    resultsPolyline = null
  }
  if (resultsStartMarker) {
    resultsStartMarker.remove()
    resultsStartMarker = null
  }
  if (resultsEndMarker) {
    resultsEndMarker.remove()
    resultsEndMarker = null
  }

  if (gpsTrack.length === 0) {
    resultsMap.setView([0, 0], 2)
    resultsMap.invalidateSize()
    return
  }

  const latLngs = gpsTrack.map((point) => L.latLng(point.lat, point.lng))

  if (latLngs.length === 1) {
    resultsStartMarker = L.circleMarker(latLngs[0], {
      radius: 8,
      color: '#2b7a3d',
      fillColor: '#2b7a3d',
      fillOpacity: 1,
      weight: 2,
    }).addTo(resultsMap)

    resultsMap.setView(latLngs[0], 17)
    resultsMap.invalidateSize()
    return
  }

  resultsPolyline = L.polyline(latLngs, {
    color: '#1f1b16',
    weight: 4,
    opacity: 0.9,
  }).addTo(resultsMap)

  resultsStartMarker = L.circleMarker(latLngs[0], {
    radius: 7,
    color: '#2b7a3d',
    fillColor: '#2b7a3d',
    fillOpacity: 1,
    weight: 2,
  }).addTo(resultsMap)

  resultsEndMarker = L.circleMarker(latLngs[latLngs.length - 1], {
    radius: 7,
    color: '#8f2d2d',
    fillColor: '#8f2d2d',
    fillOpacity: 1,
    weight: 2,
  }).addTo(resultsMap)

  const bounds = L.latLngBounds(latLngs)
  resultsMap.fitBounds(bounds.pad(0.15))
  resultsMap.invalidateSize()
}

function renderIntroPage() {
  return `
    <section class="screen">
      <header class="topbar">
        <div class="project-tag">${PROJECT_TITLE}</div>
        <button class="lang-switch" type="button" disabled>IT</button>
      </header>

      <div class="content">
        <h1>Welcome to Embodied XX0 beta.</h1>
        <p>We are about to join the pace of a scanning device.</p>
        <p>This interface provides a score to progressively tune our bodies to its operative rhythm of 883 m/h.</p>

        <section class="panel">
          <h2>Data processing consent</h2>
          <p>During the walk, this interface may collect step timing data, motion sensor data, and GPS location data.</p>
          <p>If you choose to submit the session data at the end, these data may be stored, processed, and used for artistic research, documentation, and dissemination purposes.</p>

          <label class="checkbox-row">
            <input id="consent-checkbox" type="checkbox" ${state.consentAccepted ? 'checked' : ''} />
            <span>I have read and understood the information and agree to proceed.</span>
          </label>
        </section>
      </div>

      <footer class="footer-actions">
        <button id="start-button" class="primary-button" type="button">Let’s start</button>
      </footer>
    </section>
  `
}

function renderSetupPage() {
  const resultMarkup =
    state.calculatedIntervalSec !== null
      ? `
        <section class="panel">
          <div class="eyebrow">Calculated rhythm</div>
          <div class="result-value">Your movement interval is ${state.calculatedIntervalSec.toFixed(2)} s</div>
          <p>Sensitivity: <strong>${state.sensitivity}</strong></p>
          <p>Threshold: <strong>${state.peakThreshold.toFixed(2)}</strong></p>
          <p>Refractory window: <strong>${state.refractoryMs} ms</strong></p>
        </section>
      `
      : ''

  return `
    <section class="screen">
      <header class="topbar">
        <button id="back-to-intro" class="ghost-button" type="button">Back</button>
        <div class="project-tag">PAGE 2 / BODY SETUP</div>
      </header>

      <div class="content">
        <h1>Body setup</h1>
        <p>Before entering the score, we need to calibrate a few bodily metrics.</p>
        <p>These values will be used to estimate movement interval and tune our pace to the scanner’s operative rhythm.</p>

        <section class="panel">
          <label class="field">
            <span>Step length (cm)</span>
            <input id="step-length-input" type="number" inputmode="decimal" step="0.1" placeholder="e.g. 72" value="${escapeHtml(state.stepLengthCm)}" />
          </label>

          <label class="field">
            <span>Foot length (optional)</span>
            <input id="foot-length-input" type="number" inputmode="decimal" step="0.1" placeholder="e.g. 28" value="${escapeHtml(state.footLengthCm)}" />
          </label>

          <label class="field">
            <span>Alternative movement parameters (optional)</span>
            <textarea id="alternative-input" rows="4" placeholder="Jumping, longer stride, jaguar pace...">${escapeHtml(state.alternativeMovementParameters)}</textarea>
          </label>
        </section>

        ${resultMarkup}
      </div>

      <footer class="footer-actions stacked-actions">
        <button id="calculate-button" class="primary-button" type="button">Calculate</button>
        <button id="to-calibration-button" class="secondary-button" type="button" ${state.calculatedIntervalSec === null ? 'disabled' : ''}>
          Continue to calibration
        </button>
      </footer>
    </section>
  `
}

function renderCalibrationPage() {
  const gpsText = state.gpsDenied ? 'Denied' : state.gpsEnabled ? 'Enabled' : 'Not enabled'
  const calibrationText = state.calibrationRunning ? 'On' : 'Off'

  return `
    <section class="screen">
      <header class="topbar">
        <button id="back-to-setup" class="ghost-button" type="button">Back</button>
        <div class="project-tag">PAGE 3 / CALIBRATION</div>
      </header>

      <div class="content">
        <h1>Calibration</h1>
        <p>This phase establishes the reliability of this specific entanglement.</p>
        <p>Let’s check if our bodies can attune to one another, and if our walk can be spatially traced.</p>

        <section class="panel">
          <label class="field">
            <span>Detection sensitivity</span>
            <input id="sensitivity-slider" type="range" min="1" max="10" step="1" value="${state.sensitivity}" />
          </label>

          <div class="mini-info">
            Sensitivity: <strong>${state.sensitivity}</strong><br>
            Lower = stricter, higher = more reactive<br>
            Threshold: <strong>${state.peakThreshold.toFixed(2)}</strong><br>
            Refractory window: <strong>${state.refractoryMs} ms</strong>
          </div>
        </section>

        <section class="panel">
          <div class="status-row">
            <span>Motion</span>
            <span class="status-pill ${state.motionEnabled ? '' : 'muted'}">${state.motionEnabled ? 'Enabled' : 'Not enabled'}</span>
          </div>

          <div class="status-row">
            <span>GPS</span>
            <span class="status-pill ${state.gpsEnabled ? '' : 'muted'}">${gpsText}</span>
          </div>

          <div class="status-row">
            <span>Calibration</span>
            <span class="status-pill ${state.calibrationRunning ? '' : 'muted'}">${calibrationText}</span>
          </div>

          <div class="status-row">
            <span>Calibration detected steps</span>
            <span class="status-pill">${state.calibrationDetectedSteps}</span>
          </div>

          <div class="status-row">
            <span>Motion source</span>
            <span class="status-pill muted">${state.motionSource}</span>
          </div>

          <div class="status-row">
            <span>Motion signal</span>
            <span class="status-pill muted">${state.motionSignal.toFixed(3)}</span>
          </div>

          <div class="status-row">
            <span>GPS points</span>
            <span class="status-pill muted">${state.gpsPoints}</span>
          </div>
        </section>

        <section class="panel action-list">
          <button id="enable-motion-button" class="secondary-button" type="button">Enable motion</button>
          <button id="enable-gps-button" class="secondary-button" type="button">Enable GPS</button>
          <button id="start-calibration-button" class="secondary-button" type="button">Start calibration</button>
          <button id="reset-calibration-button" class="secondary-button" type="button">Reset calibration</button>
        </section>
      </div>

      <footer class="footer-actions">
        <button id="to-performance-button" class="primary-button" type="button" ${!state.motionEnabled || state.calculatedIntervalSec === null ? 'disabled' : ''}>
          Confirm calibration
        </button>
      </footer>
    </section>
  `
}

function renderPerformancePage() {
  return `
    <section class="screen">
      <header class="topbar">
        <button id="back-to-calibration" class="ghost-button" type="button">Back</button>
        <div class="project-tag">PAGE 4 / PERFORMANCE</div>
      </header>

      <div class="content">
        <h1>Performance</h1>
        <p>We are now ready to begin.</p>
        <p>Once started, keep walking whatever happens.</p>
        <p>Try to sense how your perceptions begin to shift.</p>
        <p>Enjoy the experience as it takes place.</p>
        <p>When you have had enough, take 10 more steps before stopping.</p>

        <section class="metrics-grid">
          <div class="metric-card">
            <span class="metric-label">Elapsed time</span>
            <span class="metric-value" data-metric="elapsed-time">${state.elapsedTime}</span>
          </div>

          <div class="metric-card">
            <span class="metric-label">Theoretical steps</span>
            <span class="metric-value" data-metric="theoretical-steps">${state.theoreticalSteps}</span>
          </div>

          <div class="metric-card">
            <span class="metric-label">Detected steps</span>
            <span class="metric-value" data-metric="detected-steps">${state.detectedSteps}</span>
          </div>

          <div class="metric-card">
            <span class="metric-label">Current misalignment</span>
            <span class="metric-value" data-metric="current-misalignment">${Math.round(state.currentMisalignmentMs)} ms</span>
          </div>

          <div class="metric-card">
            <span class="metric-label">Cumulative drift</span>
            <span class="metric-value" data-metric="cumulative-drift">${Math.round(state.cumulativeDriftMs)} ms</span>
          </div>

          <div class="metric-card full-width">
            <span class="metric-label">Distance</span>
            <span class="metric-value" data-metric="distance">${state.distanceMeters.toFixed(2)} m</span>
          </div>
        </section>
      </div>

      <footer class="footer-actions stacked-actions">
        <button id="start-performance-button" class="primary-button" type="button" ${state.sessionRunning ? 'disabled' : ''}>Start</button>
        <button id="end-session-button" class="secondary-button danger-button" type="button" ${!state.sessionRunning ? 'disabled' : ''}>End session</button>
      </footer>
    </section>
  `
}

function renderResultsPage() {
  const firstGps = gpsTrack[0]
  const lastGps = gpsTrack[gpsTrack.length - 1]

  return `
    <section class="screen">
      <header class="topbar">
        <button id="back-to-performance" class="ghost-button" type="button">Back</button>
        <div class="project-tag">PAGE 5 / RESULTS</div>
      </header>

      <div class="content">
        <h1>Results</h1>
        <p>The session has ended.</p>
        <p>This page gathers the temporal and spatial traces produced during the walk.</p>

        <section class="metrics-grid">
          <div class="metric-card">
            <span class="metric-label">Total duration</span>
            <span class="metric-value">${state.elapsedTime}</span>
          </div>

          <div class="metric-card">
            <span class="metric-label">Total theoretical steps</span>
            <span class="metric-value">${state.theoreticalSteps}</span>
          </div>

          <div class="metric-card">
            <span class="metric-label">Total detected steps</span>
            <span class="metric-value">${state.detectedSteps}</span>
          </div>

          <div class="metric-card">
            <span class="metric-label">GPS points</span>
            <span class="metric-value">${state.gpsPoints}</span>
          </div>

          <div class="metric-card full-width">
            <span class="metric-label">Final distance</span>
            <span class="metric-value">${state.distanceMeters.toFixed(2)} m</span>
          </div>
        </section>

        <section class="panel">
          <div class="eyebrow">Spatial trace</div>
          <div id="results-map" class="leaflet-map"></div>
          <div class="map-meta">
            <p><strong>Track points:</strong> ${gpsTrack.length}</p>
            <p><strong>Start:</strong> ${firstGps ? `${formatCoordinate(firstGps.lat)}, ${formatCoordinate(firstGps.lng)}` : 'n/a'}</p>
            <p><strong>End:</strong> ${lastGps ? `${formatCoordinate(lastGps.lat)}, ${formatCoordinate(lastGps.lng)}` : 'n/a'}</p>
            <p><strong>GPX export:</strong> compatible with GPS tracking software.</p>
          </div>
        </section>
      </div>

      <footer class="footer-actions stacked-actions">
        <button id="download-map-jpeg-button" class="secondary-button" type="button">Download map JPEG</button>
        <button id="download-gpx-button" class="secondary-button" type="button" ${gpsTrack.length === 0 ? 'disabled' : ''}>Download GPX</button>
        <button id="to-close-button" class="primary-button" type="button">Continue</button>
      </footer>
    </section>
  `
}

function renderClosePage() {
  return `
    <section class="screen">
      <header class="topbar">
        <button id="back-to-results" class="ghost-button" type="button">Back</button>
        <div class="project-tag">PAGE 6 / CLOSE</div>
      </header>

      <div class="content">
        <h1>Session complete</h1>
        <p>You may now choose what to do with the traces produced during the walk.</p>

        <section class="panel action-list">
          <button id="send-data-button" class="secondary-button" type="button">Send data</button>
          <button id="download-data-button" class="secondary-button" type="button">Download data</button>
          <button id="delete-data-button" class="secondary-button danger-button" type="button">Delete session data</button>
        </section>

        <section class="panel">
          <div class="eyebrow">Recipient</div>
          <p>${RECIPIENT_EMAIL}</p>
          <p>Send data tries to share real files: CSV, GPX and map JPEG.</p>
        </section>
      </div>

      <footer class="footer-actions">
        <button id="finish-button" class="primary-button" type="button">Finish</button>
      </footer>
    </section>
  `
}

function getMarkup() {
  switch (state.page) {
    case 'intro':
      return renderIntroPage()
    case 'setup':
      return renderSetupPage()
    case 'calibration':
      return renderCalibrationPage()
    case 'performance':
      return renderPerformancePage()
    case 'results':
      return renderResultsPage()
    case 'close':
      return renderClosePage()
  }
}

function renderApp() {
  const app = document.querySelector<HTMLDivElement>('#app')
  if (!app) return

  if (state.page !== 'results') {
    destroyResultsMap()
  }

  app.innerHTML = `
    <main class="app-shell">
      ${getMarkup()}
    </main>
  `

  bindEvents()

  if (state.page === 'results') {
    window.requestAnimationFrame(() => {
      initOrUpdateResultsMap()
    })
  }
}

function bindEvents() {
  document.querySelector<HTMLInputElement>('#consent-checkbox')?.addEventListener('change', (event) => {
    const target = event.currentTarget as HTMLInputElement
    state.consentAccepted = target.checked
  })

  document.querySelector<HTMLButtonElement>('#start-button')?.addEventListener('click', () => {
    if (!state.consentAccepted) {
      alert('Please accept the data processing consent before continuing.')
      return
    }
    state.page = 'setup'
    renderApp()
  })

  document.querySelector<HTMLButtonElement>('#back-to-intro')?.addEventListener('click', () => {
    state.page = 'intro'
    renderApp()
  })

  document.querySelector<HTMLButtonElement>('#calculate-button')?.addEventListener('click', () => {
    const stepInput = document.querySelector<HTMLInputElement>('#step-length-input')
    const footInput = document.querySelector<HTMLInputElement>('#foot-length-input')
    const altInput = document.querySelector<HTMLTextAreaElement>('#alternative-input')

    state.stepLengthCm = stepInput?.value ?? ''
    state.footLengthCm = footInput?.value ?? ''
    state.alternativeMovementParameters = altInput?.value ?? ''

    const numericStep = Number(state.stepLengthCm)

    if (!state.stepLengthCm || Number.isNaN(numericStep) || numericStep <= 0) {
      alert('Please enter a valid step length in centimeters.')
      return
    }

    const stepLengthM = numericStep / 100
    state.calculatedIntervalSec = stepLengthM / SCANNER_SPEED_M_PER_SECOND
    state.calculatedIntervalMs = state.calculatedIntervalSec * 1000

    renderApp()
  })

  document.querySelector<HTMLButtonElement>('#to-calibration-button')?.addEventListener('click', () => {
    if (state.calculatedIntervalSec === null) return
    state.page = 'calibration'
    renderApp()
  })

  document.querySelector<HTMLButtonElement>('#back-to-setup')?.addEventListener('click', () => {
    if (!confirmLeaveDuringSession()) return
    state.page = 'setup'
    renderApp()
  })

  document.querySelector<HTMLInputElement>('#sensitivity-slider')?.addEventListener('input', (event) => {
    const target = event.currentTarget as HTMLInputElement
    applySensitivity(Number(target.value))
    renderApp()
  })

  document.querySelector<HTMLButtonElement>('#enable-motion-button')?.addEventListener('click', async () => {
    await enableMotion()
  })

  document.querySelector<HTMLButtonElement>('#enable-gps-button')?.addEventListener('click', () => {
    enableGps()
  })

  document.querySelector<HTMLButtonElement>('#start-calibration-button')?.addEventListener('click', () => {
    startCalibration()
  })

  document.querySelector<HTMLButtonElement>('#reset-calibration-button')?.addEventListener('click', () => {
    resetCalibration()
  })

  document.querySelector<HTMLButtonElement>('#to-performance-button')?.addEventListener('click', () => {
    if (!state.motionEnabled || state.calculatedIntervalSec === null) return
    state.page = 'performance'
    renderApp()
  })

  document.querySelector<HTMLButtonElement>('#back-to-calibration')?.addEventListener('click', () => {
    if (!confirmLeaveDuringSession()) return
    state.page = 'calibration'
    renderApp()
  })

  document.querySelector<HTMLButtonElement>('#start-performance-button')?.addEventListener('click', async () => {
    await startSession()
  })

  document.querySelector<HTMLButtonElement>('#end-session-button')?.addEventListener('click', () => {
    stopSession()
  })

  document.querySelector<HTMLButtonElement>('#back-to-performance')?.addEventListener('click', () => {
    state.page = 'performance'
    renderApp()
  })

  document.querySelector<HTMLButtonElement>('#download-map-jpeg-button')?.addEventListener('click', async () => {
    const jpegFile = await buildMapJpegFile()
    downloadFile(jpegFile)
  })

  document.querySelector<HTMLButtonElement>('#download-gpx-button')?.addEventListener('click', () => {
    if (gpsTrack.length === 0) return
    downloadFile(buildGpxFile())
  })

  document.querySelector<HTMLButtonElement>('#to-close-button')?.addEventListener('click', () => {
    state.page = 'close'
    renderApp()
  })

  document.querySelector<HTMLButtonElement>('#back-to-results')?.addEventListener('click', () => {
    state.page = 'results'
    renderApp()
  })

  document.querySelector<HTMLButtonElement>('#send-data-button')?.addEventListener('click', async () => {
    await sendSessionData()
  })

  document.querySelector<HTMLButtonElement>('#download-data-button')?.addEventListener('click', async () => {
    await downloadAllSessionFiles()
  })

  document.querySelector<HTMLButtonElement>('#delete-data-button')?.addEventListener('click', () => {
    deleteSessionData()
  })

  document.querySelector<HTMLButtonElement>('#finish-button')?.addEventListener('click', () => {
    resetAllState()
    renderApp()
  })
}

renderApp()