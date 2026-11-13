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

For the initial environment-sensor and on/off-output roles, "real hardware"
means more than one physical proof point. Before the device scope grows, the
same Dashboard must work concurrently with the MQTT-backed simulator, an ESP32
device and a standalone MQTT device. This
is the source-parity gate described below.

The current reference slice is the simulated temperature sensor read path. It
should become the pattern for later read-only telemetry slices by finishing the
event contract, simulator scenario coverage, availability and observation
freshness behavior, recovery behavior, realtime UI states, recent event visibility and manual acceptance
checklist for temperature first. Before the first hardware integration, the
project should add one narrow simulated LED command slice. This establishes the
full bidirectional control loop—user intent, command dispatch, observed device
report and confirmation—under repeatable simulator conditions. The real
temperature sensor path follows the simulator platform in Stage 4, the MQTT
runtime in Stage 5 and LAN security verification in Stage 5.5. The simulated
LED slice remains the reference implementation for later controllable-device
hardware.

This keeps the project from becoming either a broad dashboard with shallow
behavior or a hardware demo that skips reliability. Each later device should
reuse or deliberately adapt the previous slice pattern instead of redefining
reliability, freshness, command lifecycle and UI semantics from scratch.

## Planned Device Scope

The project deliberately freezes product breadth after Stage 3. Until the
source-parity gate is complete, the only device roles are:

- a temperature sensor providing temperature telemetry;
- an on/off output controlled through `set.power`.

The goal is to make these two roles credible across transport and hardware
boundaries, not to add a broader collection of shallow device cards. Motion,
ambient light, buttons as a separate input role and every other device role are
explicitly deferred. They may be planned only after the parity gate is met.

After Stage 5, the MQTT simulator is the normal local development and
end-to-end path. All runtime device sources use MQTT through the local broker:
the MQTT simulator, ESP32/ESPHome and standalone MQTT-capable devices. Their
native topics and payloads need not match; backend-owned adapters translate
each source into the shared platform contract. Direct invocation is retained
as a native-source/transport seam in backend unit and integration tests.

At the roadmap level, "production ready" means reliability-first for a local
project slice: clear contracts, explicit uncertainty and failure states,
repeatable simulator scenarios, meaningful tests, useful recent history or
observability and a manual acceptance checklist. It does not mean a commercial
deployment posture with cloud operations, fleet management or full monitoring.

## Roadmap Overview

| Stage     | Focus                                     | Intended outcome                                                                                          |
| --------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Stage 0   | Project foundation                        | Clear direction, initial architecture and documentation structure                                         |
| Stage 1   | Simulated temperature read path           | A working realtime UI driven by one simulated temperature sensor                                          |
| Stage 2   | Reliable simulated temperature slice      | Temperature shows availability, stale observations, recovery, history and failure signals                 |
| Stage 2.5 | Dev scenario controls                     | Manual simulator controls make reliability scenarios demonstrable                                         |
| Stage 3   | Simulated LED command reference slice     | User intent, commands and LED confirmation are visible in the simulator                                   |
| Stage 3.5 | Frontend integration test reference suite | Browser tests validate every currently supported device role against a mocked BFF                         |
| Stage 4   | Simulator platform readiness              | Telemetry, diagnostics and a repeatable local demo make the simulator slice a complete platform reference |
| Stage 5   | MQTT-backed simulator runtime             | The isolated local MQTT runtime uses scoped client access and is covered by root-level E2E                |
| Stage 5.5 | End-to-end LAN security                   | Access to the BFF, realtime stream and MQTT broker is secured and verified before hardware integration    |
| Stage 6   | ESP32 / ESPHome source                    | Environmental telemetry and on/off control use MQTT from minimal custom hardware                          |
| Stage 7   | Standalone MQTT device source             | A second, native MQTT device validates independent adapter and physical-actuation behavior                |
| Stage 8   | Dashboard source-parity gate              | All three MQTT runtime sources work concurrently with equivalent visibility and control guarantees        |
| Stage 9   | Cross-source scenes and packaging         | Explainable multi-device behavior and a final portfolio-ready narrative build on validated sources        |
| Future    | New device roles                          | Motion, ambient light or other roles are considered only after Stage 9                                    |

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
reference slice and before the first hardware integration. It covers every
device role supported at this point: the temperature read path and the LED
command path.

The goal is to verify the user-visible control loop against a controlled,
mocked BFF contract, without coupling tests to simulator or backend internals.
This stage does not start the production backend or simulator and is not an
end-to-end test of the full runtime. Its scenarios and user-visible assertions
should become the reference for a later end-to-end suite against the real
backend and then hardware-backed adapters. Playwright is the accepted runner;
the durable requirement is browser-level verification of the user-facing
contract.

Expected outcome:

- the test suite starts the frontend and drives the UI in a real browser,
- a mocked BFF deterministically supplies initial snapshots, realtime updates
  and command responses for each test scenario,
- LED tests assert requested versus confirmed state, command progress, visible
  failures and bounded command-outcome history through user-visible behavior,
- the mocked scenarios cover normal, delayed, rejected, timed-out and
  late-report flows for the LED command loop,
- temperature tests cover the documented read-path reliability states through
  user-visible behavior: fresh and stale observations, explicit availability
  loss and recovery, and realtime reconnection while retaining the last valid
  snapshot,
- tests use the BFF contract boundary rather than simulator-native messages or
  direct frontend state injection.

Stage 3.5 is complete when deterministic mocked-BFF browser suites protect the
documented user-visible behavior of every currently supported device role: the
temperature read path and LED control loop. End-to-end verification with the
real backend is a later, separate stage.

## Stage 4 - Simulator Platform Readiness

Stage 4 completes the platform on the simulator route before MQTT or hardware
add new transport and adapter concerns. It turns the temperature and LED
reference slices into a complete local system that can be tested, diagnosed and
demonstrated on its own terms.

Expected outcome:

- the simulator-backed Dashboard shows bounded telemetry history, recent events
  and storage durability with enough time context to explain current observed
  state, availability, health, freshness and command outcomes;
- `DS-4-06a` replaces the completed `DS-4-06` technical feed at the BFF
  presentation boundary with user-history changes and unsuccessful attempts,
  device-name titles and readable descriptions/timestamps; older retained entries are reachable
  through infinite scroll with bounded memory and virtual DOM rendering;
- the UI can distinguish normal values from stale observations, explicit
  availability changes, degraded health, pending commands and terminal command
  outcomes without requiring raw-event interpretation by the user;
- a technical diagnostics API and correlated JSON logs make duplicate,
  malformed, future-dated and otherwise ignored events explainable without
  turning quarantine metadata into a product feed or corrupting the projection;
- repeatable simulator scenarios cover the important normal, failure and
  recovery paths for the supported environmental-sensor and on/off-output
  roles;
- a local acceptance checklist and concise walkthrough let a reviewer run and
  understand the simulator platform without hardware.

Stage 4 establishes bounded telemetry and recent-event views. Stage 3.5 tests
only the command-outcome history already exposed by the command slice.

The accepted [Storage and Observability ADR](../decisions/adr-storage-and-observability.md)
defines the local persistence, diagnostics and history-transport model for this
stage.

The accepted [User History Projection and Virtualized Feed ADR](../decisions/adr-user-history-projection-and-virtualized-feed.md)
defines the successor product history, implemented and
verified in `DS-4-06a` after `DS-4-06` and before
`DS-4-07`. Its BFF transformation, pagination, reading-position and virtualization
evidence is complete. Stage acceptance still requires the remaining Stage 4
stories.

Stage 4 is complete when the simulator route is a trustworthy platform
reference: its state, telemetry, diagnostics and command outcomes can be
explained and verified end to end. Later MQTT and hardware stages must conform
to this reference rather than redefining its user-visible semantics.

## Stage 5 - MQTT-Backed Simulator Runtime

Stage 5 makes MQTT the normal simulator transport in the isolated local
development runtime. Backend unit and integration suites can use native-source
or transport doubles. Full-system E2E uses the real local broker.

Expected outcome:

- the BFF stays loopback-only, and the broker is reachable only from the
  isolated local development and full-system E2E runtimes;
- the broker requires separate credentials for the simulator and its backend
  adapter, with topic ACLs granting each client only the publish and subscribe
  access it needs;
- the simulator device model publishes simulator-native MQTT messages through
  local Mosquitto and receives simulator-native MQTT commands through the same
  boundary,
- a backend MQTT simulator adapter validates topics and payloads before it
  creates the same platform events and receives the same platform commands,
- broker reconnect, malformed payload, duplicate delivery, retained state and
  broker-unavailable scenarios are visible and tested at the transport level,
- losing the required broker marks MQTT-backed devices `offline` with the
  reason `broker_unavailable` and blocks their commands,
- reconnecting the backend to the broker does not restore a device to `online`
  until new trustworthy device availability evidence arrives,
- development scenario controls invoke simulator behavior through a dev-only
  backend boundary, while every resulting observation returns through MQTT;
- backend unit/integration tests use native-source or transport doubles for
  deterministic failure cases, and real-broker checks verify that the local
  configuration rejects unauthenticated clients and access outside topic ACLs;
- a root-level full-runtime end-to-end suite exercises the frontend, real BFF,
  local Mosquitto broker and MQTT simulator together without a mocked BFF or an
  alternate transport path. Its smoke scenarios cover live temperature updates,
  an LED command with confirmation and history, paged history with live additions,
  and recovery after broker loss. Detailed failure matrices remain in backend
  unit/integration and mocked-BFF frontend tests.

Stage 5 is complete when the isolated MQTT runtime provides the supported sensor
and on/off behavior, broker access restrictions are verified, and the root-level
end-to-end suite covers the normal runtime path and recovery from broker loss.

## Stage 5.5 - End-to-End LAN Security

Stage 5.5 uses the working MQTT simulator runtime to secure the full control
loop for access from a trusted LAN. It covers the Dashboard connection to the
BFF, the realtime stream and the local MQTT broker. The deployment uses local
identities and limits network exposure to the LAN. Record the durable access,
transport and broker rules in accepted decisions before implementing them.

Expected outcome:

- the runtime has explicit `dev` and `lan` profiles. The `dev` profile keeps the
  BFF loopback-only and the MQTT broker isolated locally. Deterministic domain
  and adapter tests run without LAN credentials or deployment certificates;
- the LAN profile uses HTTPS for HTTP requests and the
  [SSE stream](../decisions/adr-server-sent-events-realtime-bff.md). The BFF
  authenticates local users, enforces session-based authorization for reads,
  diagnostics, commands and realtime subscriptions, and checks CSRF protection
  on state-changing requests;
- development scenario controls require explicit enablement in `dev` and are
  unavailable in `lan`;
- secrets and credentials are kept outside version control and are redacted
  from frontend-visible errors and operational logs;
- MQTT connections over the LAN use TLS. Each adapter and device source uses
  its own credentials, and the broker grants only the publish and subscribe
  access needed for its topics;
- automated checks and a local LAN acceptance run verify an authorized
  Dashboard command and its MQTT-backed confirmation. They also verify that
  the BFF and realtime stream deny unauthenticated or unauthorized clients and
  that the real broker rejects cross-device access using separate test identities.

Stage 5.5 is complete when the secured LAN profile passes end-to-end acceptance
with the MQTT simulator and the isolated development and test paths still work.
Complete this stage before opening regular LAN access or starting Stage 6.

## Stage 6 - ESP32 / ESPHome Source

After Stage 5.5, Stage 6 adds an environmental sensor for temperature and
humidity and a low-voltage on/off output through the secured MQTT runtime.

Expected outcome:

- ESP32/ESPHome uses its own MQTT credentials and topic permissions to publish
  device-native telemetry and availability and receive `set.power` commands,
- an ESPHome adapter maps those native messages to the existing platform event
  and command model without requiring its payloads to match simulator payloads,
- UI commands remain pending until a matching ESP32 state report arrives,
- physical disconnect, broker loss, delayed report and recovery are visible in
  availability, freshness, command history and logs,
- a manual acceptance checklist covers temperature, humidity and `set.power`,
- root-level end-to-end scenarios extend the Stage 5 suite to the ESP32 source
  without introducing an alternate runtime path.

Stage 6 is complete when the ESP32 source can run beside the MQTT simulator
without changing the Dashboard's control or reliability semantics.

## Stage 7 - Standalone MQTT Device Source

Stage 7 adds a standalone device that emits MQTT events directly, rather than
running custom ESPHome firmware. A Shelly relay is one possible example, but
the architecture does not depend on a particular vendor or product.

Expected outcome:

- the standalone device connects through the same secured broker with its own
  credentials and topic permissions;
- a standalone-device adapter maps its native MQTT topics, retained state and physical
  relay changes to platform facts and `set.power` commands,
- a UI-initiated command and a physical switch change both update reported
  state through normal event processing,
- the UI and history distinguish the source and show the same command,
  availability and freshness semantics as for the ESP32 and simulator sources,
- the adapter handles broker reconnect, retained bootstrap messages, malformed
  native payloads and duplicate delivery explicitly,
- root-level end-to-end scenarios extend the same suite to the standalone
  source without bypassing its MQTT adapter.

Stage 7 is complete when a standalone device is a second independently shaped
MQTT source, not a special path that bypasses the platform model.

## Stage 8 - Dashboard Source-Parity Gate

Stage 8 proves the platform rather than adding another device role. The local
Dashboard runs the following sources concurrently:

- MQTT-backed simulator,
- ESP32 / ESPHome,
- standalone MQTT-capable device.

Expected outcome:

- every source has a distinct platform `deviceId`; parallel sources are never
  merged into an ambiguous single device, and each source exposes the same
  platform semantics for its applicable capabilities,
- the Dashboard shows source-aware telemetry, reported state, availability,
  applicable freshness, command lifecycle, recent events and logs for all
  sources,
- no source-specific Dashboard control flow bypasses the ordinary platform
  command lifecycle, history or device adapters,
- source-specific and shared failures, especially `broker_unavailable`, are
  understandable in the UI and repeatable in a local acceptance run,
- contract, domain, adapter, transport-integration and browser tests cover the
  intended boundary at the appropriate level,
- the root-level end-to-end suite covers the MQTT simulator, ESP32/ESPHome and
  standalone source together through their ordinary runtime paths.

Stage 8 is complete when all three runtime sources are useful together in one Dashboard
and the user can explain their state, events, commands and failure causes.

The later source-aware operational logs do not promote Stage 4 quarantine
diagnostics into the recent-event product feed. They are a separate operational
view whose exact access contract belongs to the source-parity stage.

## Stage 9 - Cross-Source Scenes and Packaging

Stage 9 turns the source-parity platform into a coherent, demonstrable product
slice. Telemetry depth and single-source diagnostics are already established in
Stage 4; this stage applies them across validated sources. It does not introduce
a new device source or bypass the existing event, command, availability, health
and freshness model.

Expected outcome:

- scenes and automations coordinate existing devices only through ordinary
  platform commands, retain normal command lifecycle and history, and expose
  their triggering cause;
- cross-source telemetry and recent-event views retain enough time context to
  compare current state, changes, command outcomes and relevant reliability
  conditions without becoming an unbounded raw-event console;
- multi-device normal, failure and recovery scenarios are repeatable and cover
  causality, stale observations, availability, degraded health and late command
  outcomes where they apply;
- the Dashboard, local acceptance checklist and project documentation present a
  clear walkthrough of the architecture, available sources, reliability model
  and intentional boundaries;
- the repository includes the concise packaging needed to demonstrate the
  project to a recruiter, technical lead or architect without relying on a
  long spoken explanation.

Stage 9 is complete when a user can run a local end-to-end demo, understand why
a multi-device behavior occurred, inspect the relevant telemetry and command
history, and verify the important normal and failure paths through documented
steps. Only then may the roadmap schedule motion, ambient light or another new
device role.

## Future Device Expansion

New device roles are intentionally not scheduled. After Stage 9, select the
next role through a documented decision, then prove it in the simulator and
validate it through the required MQTT production path before adding another.

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
