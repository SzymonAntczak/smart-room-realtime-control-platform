export type DeviceScenarioTarget =
    | {
          readonly kind: 'temperature';
          readonly deviceId: string;
      }
    | {
          readonly kind: 'led';
          readonly deviceId: string;
      };
