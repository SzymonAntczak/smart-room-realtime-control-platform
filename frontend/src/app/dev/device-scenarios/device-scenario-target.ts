export type DeviceScenarioTarget =
    | {
          readonly kind: 'temperature';
          readonly deviceId: string;
          readonly telemetryUnavailable: boolean;
      }
    | {
          readonly kind: 'led';
          readonly deviceId: string;
          readonly isCommandActive: boolean;
      };
