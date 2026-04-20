import './style.css'

type Page = 'intro' | 'setup' | 'calibration' | 'performance'

const SCANNER_SPEED_M_PER_HOUR = 883
const SCANNER_SPEED_M_PER_SEC = SCANNER_SPEED_M_PER_HOUR / 3600

let currentPage: Page = 'intro'

let consentAccepted = false
let stepLengthCm = ''
let footLengthCm = ''
let alternativeMovementParameters = ''
let calculatedIntervalSec: number | null = null

function renderIntroPage() {
  return `
    <section class="screen">
      <header class="topbar">
        <div class="project-tag">EMBODIED X00 DPI</div>
        <button class="lang-switch" type="button">IT</button>
      </header>

      <div class="content">
        <h1>Welcome to Embodied X00 DPI.</h1>
        <p>We are about to join the pace of a scanning device.</p>
        <p>
          This interface provides a score to progressively tune our bodies to its
          operative rhythm of 883 m/h.
        </p>

        <section class="box">
          <h2>Data processing consent</h2>
          <p>
            During the walk, this interface may collect step timing data, motion
            sensor data, and GPS location data.
          </p>
          <p>
            If you choose to submit the session data at the end, these data may be
            stored, processed, and used for artistic research, documentation, and
            dissemination purposes.
          </p>

          <label class="checkbox-row">
            <input id="consent-checkbox" type="checkbox" ${consentAccepted ? 'checked' : ''} />
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
  const resultSection =
    calculatedIntervalSec !== null
      ? `
        <section class="box result-box">
          <div class="result-label">Calculated rhythm</div>
          <div class="result-value">Your movement interval is ${calculatedIntervalSec.toFixed(2)} s</div>
          <p class="result-text">
            This value estimates the interval through which movement can tune to the scanner’s operative rhythm.
          </p>
        </section>
      `
      : ''

  const continueButton =
    calculatedIntervalSec !== null
      ? `
        <button id="continue-button" class="secondary-button" type="button">
          Continue to calibration
        </button>
      `
      : ''

  return `
    <section class="screen">
      <header class="topbar">
        <button id="back-button" class="ghost-button" type="button">Back</button>
        <div class="project-tag">PAGE 2 / BODY SETUP</div>
      </header>

      <div class="content">
        <h1>Body setup</h1>
        <p>Before entering the score, we need to calibrate a few bodily metrics.</p>
        <p>
          These values will be used to estimate movement interval and tune our pace
          to the scanner’s operative rhythm.
        </p>

        <section class="box">
          <label class="field">
            <span>Step length (cm)</span>
            <input id="step-length-input" type="number" step="0.1" value="${stepLengthCm}" placeholder="e.g. 72" />
          </label>

          <label class="field">
            <span>Foot length (optional)</span>
            <input id="foot-length-input" type="number" step="0.1" value="${footLengthCm}" placeholder="e.g. 28" />
          </label>

          <label class="field">
            <span>Alternative movement parameters (optional)</span>
            <textarea id="alternative-movement-input" rows="4" placeholder="Jumping, longer stride, jaguar pace...">${alternativeMovementParameters}</textarea>
          </label>
        </section>

        ${resultSection}
      </div>

      <footer class="footer-actions two-actions">
        <button id="calculate-button" class="primary-button" type="button">Calculate</button>
        ${continueButton}
      </footer>
    </section>
  `
}

function renderCalibrationPage() {
  return `
    <section class="screen">
      <header class="topbar">
        <button id="back-to-setup-button" class="ghost-button" type="button">Back</button>
        <div class="project-tag">PAGE 3 / CALIBRATION</div>
      </header>

      <div class="content">
        <h1>Calibration</h1>
        <p>This phase establishes the reliability of this specific entanglement.</p>
        <p>Let’s check if our bodies can attune to one another, and if our walk can be spatially traced.</p>

        <section class="box">
          <div class="status-row">
            <span>Cue active</span>
            <span class="status-pill">Ready</span>
          </div>

          <div class="status-row">
            <span>Motion detected</span>
            <span class="status-pill inactive">Waiting</span>
          </div>

          <label class="field">
            <span>Sensitivity</span>
            <input type="range" min="1" max="10" value="5" />
          </label>

          <div class="status-row">
            <span>Enable location access</span>
            <button class="small-button" type="button">Enable</button>
          </div>

          <div class="status-row">
            <span>Waiting for GPS signal</span>
            <span class="status-pill inactive">Pending</span>
          </div>

          <div class="status-row">
            <span>Map ready</span>
            <span class="status-pill inactive">No</span>
          </div>

          <button class="secondary-button" type="button">Test movement</button>
        </section>
      </div>

      <footer class="footer-actions">
        <button id="confirm-calibration-button" class="primary-button" type="button">Confirm calibration</button>
      </footer>
    </section>
  `
}

function renderPerformancePage() {
  return `
    <section class="screen">
      <header class="topbar">
        <button id="back-to-calibration-button" class="ghost-button" type="button">Back</button>
        <div class="project-tag">PAGE 4 / PERFORMANCE</div>
      </header>

      <div class="content">
        <h1>Performance</h1>
        <p>We are now ready to begin.</p>
        <p>Once started, keep walking whatever happens.</p>
        <p>Try to sense how your perceptions begin to shift.</p>
        <p>Enjoy the experience as it takes place.</p>
        <p>When you have had enough, take 10 more steps before stopping.</p>

        <section class="box">
          <div class="metric-card">
            <span class="metric-label">Elapsed time</span>
            <span class="metric-value">00:00</span>
          </div>

          <div class="metric-card">
            <span class="metric-label">Theoretical steps</span>
            <span class="metric-value">0</span>
          </div>

          <div class="metric-card">
            <span class="metric-label">Detected steps</span>
            <span class="metric-value">0</span>
          </div>

          <div class="metric-card">
            <span class="metric-label">Cumulative drift</span>
            <span class="metric-value">0</span>
          </div>

          <div class="metric-card">
            <span class="metric-label">Distance</span>
            <span class="metric-value">0 m</span>
          </div>
        </section>
      </div>

      <footer class="footer-actions two-actions">
        <button id="performance-start-button" class="primary-button" type="button">Start</button>
        <button id="end-session-button" class="secondary-button danger-button" type="button">End session</button>
      </footer>
    </section>
  `
}

function getMarkup() {
  if (currentPage === 'intro') return renderIntroPage()
  if (currentPage === 'setup') return renderSetupPage()
  if (currentPage === 'calibration') return renderCalibrationPage()
  return renderPerformancePage()
}

function calculateInterval(stepCm: number) {
  const stepMeters = stepCm / 100
  return stepMeters / SCANNER_SPEED_M_PER_SEC
}

function renderApp() {
  const app = document.querySelector<HTMLDivElement>('#app')
  if (!app) return

  app.innerHTML = `
    <main class="app">
      ${getMarkup()}
    </main>
  `

  bindEvents()
}

function bindEvents() {
  const consentCheckbox = document.querySelector<HTMLInputElement>('#consent-checkbox')
  const startButton = document.querySelector<HTMLButtonElement>('#start-button')

  const backButton = document.querySelector<HTMLButtonElement>('#back-button')
  const calculateButton = document.querySelector<HTMLButtonElement>('#calculate-button')
  const continueButton = document.querySelector<HTMLButtonElement>('#continue-button')

  const backToSetupButton = document.querySelector<HTMLButtonElement>('#back-to-setup-button')
  const confirmCalibrationButton = document.querySelector<HTMLButtonElement>('#confirm-calibration-button')

  const backToCalibrationButton = document.querySelector<HTMLButtonElement>('#back-to-calibration-button')
  const performanceStartButton = document.querySelector<HTMLButtonElement>('#performance-start-button')
  const endSessionButton = document.querySelector<HTMLButtonElement>('#end-session-button')

  consentCheckbox?.addEventListener('change', () => {
    consentAccepted = consentCheckbox.checked
  })

  startButton?.addEventListener('click', () => {
    if (!consentCheckbox?.checked) {
      alert('Please accept the data processing consent before continuing.')
      return
    }

    consentAccepted = true
    currentPage = 'setup'
    renderApp()
  })

  backButton?.addEventListener('click', () => {
    currentPage = 'intro'
    renderApp()
  })

  calculateButton?.addEventListener('click', () => {
    const stepInput = document.querySelector<HTMLInputElement>('#step-length-input')
    const footInput = document.querySelector<HTMLInputElement>('#foot-length-input')
    const altInput = document.querySelector<HTMLTextAreaElement>('#alternative-movement-input')

    stepLengthCm = stepInput?.value ?? ''
    footLengthCm = footInput?.value ?? ''
    alternativeMovementParameters = altInput?.value ?? ''

    const numericStep = Number(stepLengthCm)

    if (!stepLengthCm || Number.isNaN(numericStep) || numericStep <= 0) {
      alert('Please enter a valid step length in centimeters.')
      return
    }

    calculatedIntervalSec = calculateInterval(numericStep)
    renderApp()
  })

  continueButton?.addEventListener('click', () => {
    currentPage = 'calibration'
    renderApp()
  })

  backToSetupButton?.addEventListener('click', () => {
    currentPage = 'setup'
    renderApp()
  })

  confirmCalibrationButton?.addEventListener('click', () => {
    currentPage = 'performance'
    renderApp()
  })

  backToCalibrationButton?.addEventListener('click', () => {
    currentPage = 'calibration'
    renderApp()
  })

  performanceStartButton?.addEventListener('click', () => {
    alert('Performance started.')
  })

  endSessionButton?.addEventListener('click', () => {
    alert('Session ended.')
  })
}

renderApp()