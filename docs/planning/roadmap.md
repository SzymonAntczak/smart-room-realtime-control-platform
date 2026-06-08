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

## Planned Device Scope

The planned device set should stay small, but it should cover enough different
signals to exercise the system model.

Initial device candidates:

- temperature sensor,
- humidity sensor,
- motion sensor,
- ambient light sensor,
- LED output,
- physical LED button.

This set gives the project a useful mix of telemetry, presence detection,
environmental context, physical input and visible output. The exact hardware
models can be chosen later; at the roadmap level, the important part is the
role each device plays in the control loop.

## Roadmap Overview

| Stage   | Focus                     | Intended outcome                                                         |
| ------- | ------------------------- | ------------------------------------------------------------------------ |
| Stage 0 | Project foundation        | Clear direction, initial architecture and documentation structure        |
| Stage 1 | Simulated realtime system | A working realtime UI driven by simulated events                         |
| Stage 2 | Reliable control behavior | Clear handling of requested, pending, confirmed, failed and stale states |
| Stage 3 | Minimal real hardware     | One real physical loop connected to the same system model                |
| Stage 4 | Telemetry and history     | Useful event history, trends and operational visibility                  |
| Stage 5 | Automation UX             | Simple explainable rules and scenes                                      |
| Stage 6 | Testing and resilience    | Repeatable failure scenarios and confidence in behavior                  |
| Stage 7 | Portfolio packaging       | Demo, case study and project narrative                                   |

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

## Stage 1 - Simulated Realtime System

Stage 1 creates the first useful vertical slice without waiting for physical
hardware.

The goal is to make the interface react to live system events and establish the
basic feedback loop between simulated devices, system state and the user.

Expected outcome:

- simulated devices produce realtime updates,
- the UI shows current device state,
- the system exposes an event feed or history view,
- the first control actions can be represented,
- the project becomes demonstrable without special equipment.

Stage 1 is complete when a user can watch system state change in realtime and
understand where those changes came from.

## Stage 2 - Reliable Control Behavior

Stage 2 turns the project from a dashboard into a control system.

The goal is to make uncertainty visible. The UI should not pretend that a
requested change is already confirmed, and the system should treat failures,
delays and missing data as normal parts of operation.

Expected outcome:

- requested state is separated from confirmed state,
- pending commands are visible,
- failed and timed-out actions are understandable,
- stale and offline devices are shown clearly,
- delayed or missing updates are part of the system model,
- event history can explain important user actions.

Stage 2 is complete when the system can demonstrate both successful and failed
control flows without hiding uncertainty from the user.

## Stage 3 - Minimal Real Hardware

Stage 3 adds a small physical proof of the system model.

The goal is not to maximize hardware scope. The goal is to prove that the same
event and control ideas work when at least one real device is involved.

Expected outcome:

- one real device participates in the control loop,
- physical input or sensor data appears in the UI,
- a UI action can affect a physical output,
- disconnecting or delaying the real device is handled visibly,
- the real device follows the same mental model as the simulator.

Stage 3 is complete when the project can show a real end-to-end flow without
changing the core system story.

## Stage 4 - Telemetry And History

Stage 4 makes the system easier to inspect, debug and explain over time.

The goal is to move beyond current state and give the user enough history to
understand what happened, when it happened and whether the system behaved
reliably.

Expected outcome:

- important events are historically visible,
- telemetry can be inspected over time,
- last-seen and freshness information is available,
- latency or responsiveness can be discussed,
- the system can support simple operational questions.

Stage 4 is complete when the system can explain both the current state and the
recent path that led to it.

## Stage 5 - Automation UX

Stage 5 explores controlled automation without hiding responsibility from the
user.

The goal is to design simple rules and scenes in a way that remains
understandable, inspectable and explainable.

Expected outcome:

- simple automations or scenes can be represented,
- the UI can show why an automation triggered,
- automation activity appears in history,
- manual control and automation can be reasoned about together,
- the user can understand what the system is likely to do next.

Stage 5 is complete when automation adds value without making the system feel
opaque.

## Stage 6 - Testing And Resilience

Stage 6 proves that the important behaviors are repeatable.

The goal is to test the parts that carry the real project value: state
derivation, command lifecycle, realtime UI behavior and failure handling.

Expected outcome:

- core state transitions are tested,
- command success, failure and timeout scenarios are tested,
- simulator scenarios cover realistic failure modes,
- UI behavior is verified for important user-visible states,
- a manual demo checklist exists.

Stage 6 is complete when the project can intentionally reproduce failures and
show that the system responds in a predictable way.

## Stage 7 - Portfolio Packaging

Stage 7 turns the project into something that can be understood outside the
repository.

The goal is to present the project as a coherent technical story: the problem,
the model, the trade-offs, the implementation and the lessons learned.

Expected outcome:

- the main README explains the project clearly,
- the architecture can be understood quickly,
- a short demo or walkthrough exists,
- important trade-offs are documented,
- the project explains how AI was used and verified,
- the final narrative supports technical conversation.

Stage 7 is complete when the project can be shown to a recruiter, tech lead or
architect without needing a long spoken preface.

## Success Criteria

The roadmap is successful if the finished project can show:

- a local realtime control loop,
- simulated and at least minimal real device behavior,
- honest UI states for requested, confirmed, pending, failed, offline and stale
  conditions,
- useful event and telemetry history,
- documented architectural decisions,
- repeatable failure scenarios,
- a clear explanation of where AI helped and where human system design mattered.

## Guiding Principle

Build a small system that behaves honestly under uncertainty. The project does
not need to be large to be valuable; it needs to make state, time, intent and
failure visible.
