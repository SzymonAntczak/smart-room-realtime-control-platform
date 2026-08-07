# Smart Room Realtime Control Platform Roadmap

This roadmap describes the intended direction for the Smart Room Realtime
Control Platform. It is a planning guide, not a technical contract and not the
source of truth for current system behavior.

The project should grow from a small simulated realtime control system into a
portfolio-ready realtime/IoT platform that demonstrates system design,
reliable control UX, event thinking and responsible AI-assisted development.

## Strategic Direction

The project is not meant to be a hardware-heavy smart home build. Hardware is
only one proof point. The core value is the ability to design a trustworthy
realtime control system where users can understand what was requested, what was
confirmed, what failed and what is uncertain.

The main emphasis is:

- realtime control UX,
- event and command modeling,
- explicit handling of delays, failures and stale data,
- architectural documentation and decision making,
- a small but credible end-to-end system,
- AI used as an implementation assistant, not as the system designer.

## Delivery Principle

The planned device list describes product breadth, not implementation order.
The project should complete one narrow device slice to a reliable, explainable
standard before adding more device roles.

Each device or capability should move through the same delivery rhythm:

1. build the slice in the simulator,
2. make it reliable enough to explain and test,
3. validate the same slice on real hardware,
4. then move to the next device role or capability.

The current reference slice is the simulated temperature sensor read path. It
should become the pattern for later read-only telemetry slices by finishing the
event contract, simulator scenario coverage, availability and observation
freshness behavior, recovery behavior, realtime UI states, recent event visibility and manual acceptance
checklist for temperature first. Before the first hardware integration, the
project should add one narrow simulated LED command slice. This establishes the
full bidirectional control loop—user intent, command dispatch, observed device
report and confirmation—under repeatable simulator conditions. The real
temperature sensor path follows after browser-level frontend integration tests
validate the user-visible control loop against controlled BFF responses; the
simulated LED slice remains the reference implementation for later
controllable-device hardware.

This keeps the project from becoming either a broad dashboard with shallow
behavior or a hardware demo that skips reliability. Each later device should
reuse or deliberately adapt the previous slice pattern instead of redefining
reliability, freshness, command lifecycle and UI semantics from scratch.

## Planned Device Scope

The planned device set should stay small, but it should cover enough different
signals to exercise the system model.

Initial device candidates:

- temperature sensor,
- motion sensor,
- ambient light sensor,
- LED output,
- physical LED button,
- humidity sensor as a later optional telemetry role.

This set gives the project a useful mix of telemetry, presence detection,
environmental context, physical input and visible output. The exact hardware
models can be chosen later; at the roadmap level, the important part is the
role each device plays in the control loop.

Ambient light should be the next read-only sensor after the temperature, LED
and motion slices are reliable. It adds more learning value than another
temperature-like telemetry sensor because it gives automation contextual
meaning: motion can turn on the LED only when the room is dark. Humidity can
remain optional until the project needs another environmental time-series
signal.

These roles should not all be implemented in the simulator before hardware work
begins. The temperature sensor is the first read-only reference implementation.
After its simulated reliability slice, one simulated LED control slice should
prove the bidirectional command path before browser-level frontend integration
tests validate it against a mocked BFF contract. The real temperature sensor
can then validate the read model with physical transport and timing. Each later
device role should still be proven in the simulator before its corresponding
hardware validation.

At the roadmap level, "production ready" means reliability-first for a local
project slice: clear contracts, explicit uncertainty and failure states,
repeatable simulator scenarios, meaningful tests, useful recent history or
observability and a manual acceptance checklist. It does not mean a commercial
deployment posture with cloud operations, fleet management or full monitoring.

## Roadmap Overview

| Stage     | Focus                                     | Intended outcome                                                                          |
| --------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| Stage 0   | Project foundation                        | Clear direction, initial architecture and documentation structure                         |
| Stage 1   | Simulated temperature read path           | A working realtime UI driven by one simulated temperature sensor                          |
| Stage 2   | Reliable simulated temperature slice      | Temperature shows availability, stale observations, recovery, history and failure signals |
| Stage 2.5 | Dev scenario controls                     | Manual simulator controls make reliability scenarios demonstrable                         |
| Stage 3   | Simulated LED command reference slice     | User intent, commands and LED confirmation are visible in the simulator                   |
| Stage 3.5 | Frontend integration test reference suite | Browser tests validate UI behavior against a mocked BFF                                   |
| Stage 4   | Real temperature hardware slice           | A real temperature sensor validates the same read model                                   |
| Stage 5   | Real LED button and output hardware slice | Physical input or UI control affects a real LED through the same model                    |
| Stage 6   | Simulated motion-triggered LED behavior   | Motion telemetry can trigger LED behavior with explainable causality                      |
| Stage 7   | Real motion sensor hardware slice         | A physical motion sensor validates the motion-triggered LED behavior                      |
| Stage 8   | Simulated ambient light slice             | Lux readings add context for light-aware automation                                       |
| Stage 9   | Real ambient light hardware slice         | A physical light sensor validates the same contextual read model                          |
| Stage 10  | Scenes, telemetry depth and packaging     | Multi-device scenes, history, resilience and project narrative mature                     |

## Stage 0 - Project Foundation

Stage 0 establishes the project as a system-design exercise, not just an
application setup task.

The goal is to define the direction, boundaries and first architectural
language of the project.

Expected outcome:

- the project goal is documented,
- the documentation structure exists,
- the first system model is described,
- early architectural decisions are captured,
- the role of AI in the project is made explicit,
- the next implementation stage is clear.

Stage 0 is complete when the repository explains what kind of system is being
built, why it matters and how the first simulated slice should behave.

## Stage 1 - Simulated Temperature Read Path

Stage 1 creates the first useful vertical slice without waiting for physical
hardware. The slice is intentionally narrow: one simulated temperature sensor
feeding a backend-backed realtime read path.

The goal is to make the interface react to live system events and establish the
basic feedback loop between a simulated device, backend state and the user.

Expected outcome:

- the simulated temperature sensor produces realtime updates,
- the UI shows the current temperature state,
- the backend translates simulator-native readings into platform events,
- the event processor validates and projects accepted telemetry,
- the project becomes demonstrable without special equipment.

Stage 1 is complete when a user can watch system state change in realtime and
understand where those changes came from.

## Stage 2 - Reliable Simulated Temperature Slice

Stage 2 turns the first realtime read path from a live value into a trustworthy
reference implementation.

The goal is to make uncertainty visible for temperature before broadening the
device set. The system should treat missing telemetry, stale data, duplicate
events, invalid events, offline periods and recovery as normal parts of
operation.

Expected outcome:

- availability and stale temperature observations are shown clearly and separately,
- delayed or missing temperature updates are part of the system model,
- duplicate and invalid temperature telemetry do not corrupt current state,
- availability recovery and later fresh observations are visible and tested,
- development diagnostics make ignored duplicate and invalid telemetry explainable,
- a manual acceptance checklist exists for the temperature slice.

Stage 2 is complete when the temperature slice can demonstrate normal
availability, stale observations, explicit offline, invalid, duplicate and
recovery flows without hiding uncertainty from the user.

## Stage 2.5 - Dev Scenario Controls

Stage 2.5 makes the reliable simulated temperature slice manually
demonstrable before hardware work begins.

The goal is to add development-only controls for simulator scenarios so the
temperature reliability checklist can be clicked through during local
acceptance and demos. These controls are not product features. They should
exercise the same backend-owned event flow as normal simulator readings instead
of mutating frontend state directly.

Expected outcome:

- a local dev panel or equivalent dev-only controls can trigger temperature
  simulator scenarios,
- supported actions include pausing telemetry, resuming telemetry, replaying
  the last reading, emitting an invalid reading, emitting the next reading and
  resetting the scenario,
- each action flows through backend scenario control, simulator behavior,
  adapter translation, event processing, projection updates and realtime delivery
  through the connection snapshot baseline or revision-linked device updates,
- the UI can manually demonstrate normal availability, stale observations,
  explicit offline, recovery, duplicate, invalid and reconnect behavior without
  changing the product model,
- the dev controls are clearly separated from the user-facing smart-room
  surface and can be reused by later simulator-first slices.

Stage 2.5 is complete when the temperature reliability scenarios are not only
covered by automated tests, but can also be demonstrated manually through the
local simulator control path. Stage 3 should wait until this manual acceptance
loop exists.

## Stage 3 - Simulated LED Command Reference Slice

Stage 3 introduces the first controllable device behavior while retaining the
simulator as the only external device source.

The goal is to exercise the entire bidirectional control loop before hardware
is connected: a user action becomes a platform command, the backend adapter
translates it to a simulator-native command, and an observed LED state report
returns through the normal event path to confirm or fail the request.

Expected outcome:

- the simulated LED exposes `set.power` behavior,
- a UI control can request LED state changes,
- requested LED state is never displayed as confirmed before evidence arrives,
- normal confirmation, delayed confirmation, rejection, timeout and late
  report scenarios are repeatable,
- command history explains what was requested, dispatched and confirmed or
  failed,
- the slice has a manual acceptance checklist for the full bidirectional loop.

Stage 3 is complete when the simulated LED command loop is reliable and
explainable enough to serve as the reference command slice before the first
hardware integration.

## Stage 3.5 - Frontend Integration Test Reference Suite

Stage 3.5 adds browser-level frontend integration tests after the simulated LED
reference slice and before the first hardware integration.

The goal is to verify the user-visible control loop against a controlled,
mocked BFF contract, without coupling tests to simulator or backend internals.
This stage does not start the production backend or simulator and is not an
end-to-end test of the full runtime. Its scenarios and user-visible assertions
should become the reference for a later end-to-end suite against the real
backend and then hardware-backed adapters. The choice between Playwright and
Cypress belongs to implementation planning; the durable requirement is
browser-level verification of the user-facing contract.

Expected outcome:

- the test suite starts the frontend and drives the UI in a real browser,
- a mocked BFF deterministically supplies initial snapshots, realtime updates
  and command responses for each test scenario,
- tests assert requested versus confirmed state, command progress, visible
  failures and relevant event history through user-visible behavior,
- the mocked scenarios cover normal, delayed, rejected, timed-out and
  late-report flows for the LED command loop,
- tests use the BFF contract boundary rather than simulator-native messages or
  direct frontend state injection.

Stage 3.5 is complete when the browser suite protects the documented LED
control-loop behavior with deterministic mocked BFF scenarios. End-to-end
verification with the real backend is a later, separate stage.

## Stage 4 - Real Temperature Hardware Slice

Stage 4 validates the temperature read model with a real physical sensor.

The goal is not to introduce new product behavior. The goal is to prove that
the simulator-backed temperature model survives real transport, real timing,
real connection behavior and hardware-specific quirks without changing the core
system story.

Expected outcome:

- one real temperature sensor reports through a backend-owned adapter,
- real readings use the same platform event and projection model as the
  simulator,
- disconnecting becomes visible through availability, while delayed or stopped
  readings become visible through observation freshness,
- recent history can explain whether a reading came from simulator or hardware,
- the hardware slice has a manual acceptance checklist.

Stage 4 is complete when a real temperature sensor can replace or sit beside
the simulator without changing the read-path mental model.

## Stage 5 - Real LED Button And Output Hardware Slice

Stage 5 validates the LED command model with physical input and output.

The goal is to prove that the same requested-vs-confirmed state model works
when a real button, LED, ESP32, MQTT, Home Assistant or another local hardware
path participates in the loop.

Expected outcome:

- a physical input or UI action can request a real LED state change,
- the hardware adapter translates device-native messages into the same platform
  events used by the simulator,
- command confirmation, rejection, timeout and disconnect behavior remain
  visible,
- the UI can show whether current LED state came from real hardware evidence,
- the hardware slice has a manual acceptance checklist.

Stage 5 is complete when the real LED slice follows the same command lifecycle
and user-facing reliability rules as the simulated LED slice.

## Stage 6 - Simulated Motion-Triggered LED Behavior

Stage 6 introduces device-to-device behavior in the simulator.

The goal is to add a simulated motion sensor and use motion detection to
trigger LED behavior while keeping causality visible. This is the first slice
where one device observation can cause a command or desired behavior for
another device.

Expected outcome:

- simulated motion telemetry follows the read-only sensor reliability model,
- motion-triggered LED behavior is represented as an explainable system action,
- automation-triggered commands use the same command lifecycle as manual
  commands,
- history shows the motion event, the triggered intent and the LED result,
- stale motion observations or offline availability do not silently drive automation.

Stage 6 is complete when the simulator can demonstrate motion-driven LED
behavior without hiding why the LED changed.

## Stage 7 - Real Motion Sensor Hardware Slice

Stage 7 validates the motion-triggered LED behavior with a real motion sensor.

The goal is to check whether the simulated motion assumptions hold when motion
events arrive from physical hardware with real timing, noise and connection
behavior.

Expected outcome:

- a real motion sensor reports through a backend-owned adapter,
- real motion observations use the same platform model as simulated motion,
- the system can trigger LED behavior from real motion events,
- hardware noise, disconnects or missing reports are visible instead of hidden,
- the hardware slice has a manual acceptance checklist.

Stage 7 is complete when real motion can trigger LED behavior through the same
explainable event and command model proven in the simulator.

## Stage 8 - Simulated Ambient Light Slice

Stage 8 adds a simulated ambient light sensor after the project already has
temperature telemetry, LED command behavior and motion-triggered behavior.

The goal is to add environmental context that makes automation more realistic.
Ambient light should follow the read-only sensor reliability model while
teaching threshold-based interpretation such as bright, dim or dark conditions.

Expected outcome:

- simulated lux readings flow through the same adapter, event and projection
  model as other telemetry,
- availability, stale observation, invalid-data and recovery behavior are visible for ambient light,
- light-level interpretation is explainable and does not hide raw telemetry,
- motion-triggered LED behavior can be constrained by "room is dark" context,
- the slice has a manual acceptance checklist.

Stage 8 is complete when simulated ambient light can provide reliable context
for automation without becoming a one-off telemetry path.

## Stage 9 - Real Ambient Light Hardware Slice

Stage 9 validates the ambient light model with a real light sensor.

The goal is to check whether the simulated lux and threshold assumptions hold
under real room lighting, sensor noise, placement differences and connection
behavior.

Expected outcome:

- a real ambient light sensor reports through a backend-owned adapter,
- real lux observations use the same platform model as simulated light,
- sensor noise, missing reports and disconnects are visible instead of hidden,
- the system can explain when motion did or did not trigger LED behavior
  because the room was bright enough,
- the hardware slice has a manual acceptance checklist.

Stage 9 is complete when real ambient light can safely act as contextual input
for light-aware automation.

## Stage 10 - Scenes, Telemetry Depth And Packaging

Stage 10 grows the project after several device roles already exist in both the
simulator-first and hardware-validated model.

The goal is to make multi-device behavior easier to define, inspect, test and
explain. Scenes and automation should build on the existing event, state,
command, history and reliability model instead of bypassing it.

Expected outcome:

- simple scenes can coordinate the existing temperature, LED, motion and
  ambient light roles,
- the first light-aware scene can express "when motion is detected and the room
  is dark, turn on the LED for a bounded time",
- automation activity appears in history with clear triggering causes,
- telemetry and event history can answer operational questions over time,
- repeatable failure scenarios cover state derivation, command lifecycle,
  realtime UI behavior and hardware validation,
- the README, architecture and walkthrough explain the project clearly.

Stage 10 is complete when the project can intentionally reproduce important
normal and failure flows, show that the system responds predictably and be
shown to a recruiter, tech lead or architect without needing a long spoken
preface.

## Cross-Slice Reliability Expectations

Every device or capability slice should be treated as complete only when it can
be explained and verified at the same standard as the previous slices.

Expected for each slice:

- relevant contracts and message shapes are documented or consciously deferred,
- simulator scenarios cover realistic normal and failure modes,
- state derivation or command lifecycle behavior is tested where the slice
  touches it,
- a manual demo checklist exists,
- the UI exposes freshness, uncertainty, command progress or failure when those
  concerns apply,
- history or recent-event visibility can explain how the current state was
  reached.

## Success Criteria

The roadmap is successful if the finished project can show:

- a local realtime control loop,
- simulated and at least minimal real device behavior,
- honest UI states for requested, confirmed, pending and failed commands, plus
  independent availability and observation-freshness conditions,
- useful event and telemetry history,
- documented architectural decisions,
- repeatable failure scenarios,
- a clear explanation of where AI helped and where human system design mattered.

## Guiding Principle

Build a small system that behaves honestly under uncertainty. The project does
not need to be large to be valuable; it needs to make state, time, intent and
failure visible.
