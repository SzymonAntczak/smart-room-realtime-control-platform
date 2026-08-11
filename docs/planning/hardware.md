# Required Hardware

This list supports the current roadmap only: temperature/humidity telemetry,
an on/off output, MQTT transport and validation against a standalone device.
Do not buy additional sensor roles before the Dashboard source-parity gate is
complete.

## Buy Before Stage 6

- **ESP32 development board** with a USB data cable. Choose a commonly
  supported board with accessible GPIO and Wi-Fi; USB-C is convenient but not
  required.
- **I2C temperature and humidity sensor breakout**, for example an AHT20 or
  BME280. One sensor is enough for the first ESP32 source.
- **Breadboard and Dupont wires** appropriate for the selected board and
  breakout.
- **Low-voltage on/off demonstrator**: LED, suitable current-limiting resistor
  and, if desired, a low-voltage relay module. This is sufficient to validate
  `set.power` without connecting a breadboard to mains voltage.

## Buy Before Stage 7

- **One MQTT-capable standalone relay/switch** that can expose relay state and
  accept on/off control through its local MQTT configuration. A Shelly device
  is one possible choice; select the exact model only after confirming local
  MQTT support and the intended physical installation.

## Not Required Initially

- a motion sensor;
- an ambient-light sensor;
- additional temperature/humidity sensors;
- cloud hubs or Home Assistant;
- more ESP32 boards.

## Safety Boundary

Use the ESP32 and breadboard only for low-voltage experiments. Any standalone
device connected to 230 V, such as a Shelly relay, must be installed and tested
in an appropriate enclosure by a qualified electrician. Do not connect mains
voltage to a breadboard, Dupont wires or an exposed relay module.

## Purchase Gate

Before buying another device, complete Stage 8: the Dashboard must show the
MQTT simulator, ESP32 and a standalone MQTT-capable device
concurrently with applicable telemetry or reported state, events, logs and
honest command state. Cross-source scenes are introduced in Stage 9.
