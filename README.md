# Runway Circuit Simulator

Runway Circuit Simulator is a static browser flight simulation prototype focused on the core pilot loop: taxi, take-off, climb, circuit navigation, approach, landing, rollout, and restart.

The design goal is a believable general-aviation feel for a single-engine light aircraft analogue, delivered as a clean, dependency-free web app that runs locally and on GitHub Pages.

## Project overview

- **Genre:** desktop-first flight simulation prototype
- **Aircraft:** single-engine light prop analogue with flap/trim/rudder/brakes
- **Core loop:** start on runway environment → fly a circuit → land with scoring → restart
- **Modes:** Free Flight + Assisted Training + Cold Start
- **Platform:** static HTML/CSS/JS (no backend, no build step)

## How to run locally

No install/build required.

1. Clone the repository.
2. Open `index.html` in a modern desktop browser (Chrome recommended).
3. Click **Free Flight** or **Assisted Training**.

Optional: use any local static server if your browser blocks some autoplay/audio behavior from `file://`.

## Controls

- `W / S`: pitch down / pitch up
- `A / D`: roll left / roll right
- `Q / E`: rudder left / right (nosewheel steering on ground)
- `Arrow Up / Arrow Down`: throttle increase / decrease
- `F / V`: flaps increase / decrease
- `[` / `]`: trim nose down / up
- `Space`: wheel brakes
- `B`: toggle parking brake
- `I`: engine start / stop
- `C`: toggle camera (cockpit/chase)
- `P`: pause
- `R`: restart run
- `H`: toggle training hint text

## Simulation model summary

The sim uses a compact physics model tuned for believable takeoff/landing behavior rather than arcade movement:

- Lift from dynamic pressure (`q = 0.5 rho v^2`) and angle-of-attack-derived lift coefficient.
- Drag from parasitic + induced + flap configuration drag.
- Thrust from throttle command with **engine spool lag**.
- Gravity + vertical force balance to compute climb/descent rate.
- Roll/pitch/yaw damping and inertia terms.
- Distinct ground handling with steering/friction/braking.
- Flap effects increase lift and drag.
- Ground-effect boost near the runway.
- Stall region: lift degradation and warning behavior at high AoA/low speed.
- Wind drift modeled as a world-space vector.

## Scoring and evaluation

Landing evaluation runs on touchdown and rollout completion:

- Runway validity (in bounds vs excursion)
- Vertical touchdown rate
- Heading alignment to runway direction
- Centerline offset
- Overspeed/hard-landing/crash conditions

Landing score is a weighted blend of sink rate, alignment, and centerline control. Best landing score is persisted in `localStorage`.

## Architecture overview

Project structure:

- `index.html`: app shell, menus, overlays, HUD containers
- `styles.css`: UI/HUD styling and overlay layout
- `src/main.js`: simulation loop, physics, renderer, scoring, input, audio, persistence

Runtime systems inside `main.js`:

- `Simulator`: aircraft state machine + physics + phase management + crash/score logic
- `Renderer`: canvas scene rendering (cockpit/chase view, runway, terrain grid, landmarks, HUD cues)
- `AudioController`: lightweight procedural engine/touchdown audio via WebAudio

## Deployment notes (GitHub Pages)

This app is fully static, so use **Deploy from a branch** with the **branch root** folder.

Recommended setup:

1. Push this feature branch and open/merge the PR.
2. In GitHub repository settings, open **Pages**.
3. Set source to your deployment branch (typically `main`) and folder to **`/ (root)`**.
4. Save and wait for Pages to publish.

If you intentionally keep a separate site branch, branch root is still correct as long as `index.html` stays at the top level.

No server or build pipeline is required.

## First-time remote push (step-by-step)

If your local repo has no remote yet:

1. Create an empty GitHub repository.
2. Add it as origin: `git remote add origin https://github.com/<user>/<repo>.git`
3. Verify: `git remote -v`
4. Push branch: `git push -u origin feat/browser-flight-sim`

## Known limitations

- Physics are simplified and tuned for playability, not study-level fidelity.
- Runway environment is handcrafted and bounded (not a large terrain engine).
- No full cockpit 3D mesh; cockpit mode uses forward-view symbology/HUD overlay.
- Audio is procedural and intentionally lightweight.
- No mobile control mapping; this is desktop-first.

## Sensible future improvements

- Add configurable weather presets and gust model.
- Add AI traffic pattern ghost/reference aircraft.
- Expand airport with lighting/night operation presets.
- Improve instrument panel with dedicated attitude and heading tapes.
- Add replay timeline and touchdown telemetry graph.
- Add configurable control sensitivities and joystick/gamepad profile UI.
