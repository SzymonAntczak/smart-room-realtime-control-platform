export const pl = {
    common: {
        alert: {
            none: 'Brak bieżących alertów.',
        },
        availability: {
            offline: 'Offline',
            online: 'Online',
            unknown: 'Nieznany',
        },
    },
    dashboard: {
        devices: {
            ledMain: 'Główne LED',
            temperatureDesk: 'Temperatura biurka',
            temperatureWindow: 'Temperatura okna',
        },
        realtime: {
            connecting: 'Łączenie ze strumieniem pokoju w czasie rzeczywistym…',
            reconnecting: 'Ponowne łączenie ze strumieniem pokoju w czasie rzeczywistym…',
        },
        led: {
            alert: {
                commandConfirmed: 'Polecenie potwierdzone o {{time}}.',
                commandTimedOut: 'Upłynął limit czasu polecenia: {{reason}}.',
                degraded: 'Stan LED jest pogorszony.',
                offline: 'LED jest offline{{reason}}',
                realtimeReconnecting:
                    'Strumień czasu rzeczywistego ponownie się łączy. Sterowanie LED jest chwilowo niedostępne.',
                requested: 'Zażądano: {{power}} — oczekiwanie na raport urządzenia.',
                stale: 'Obserwacja stanu LED jest nieaktualna.',
                submitting: 'Wysyłanie polecenia LED.',
            },
            confirmed: 'Potwierdzono:',
            commandRequestFailed: 'Nie udało się wysłać polecenia LED. Spróbuj ponownie.',
            confirmedPower: 'Potwierdzone zasilanie LED',
            controls: 'Elementy sterowania zasilaniem LED',
            off: 'Wyłączone',
            on: 'Włączone',
            turnOff: 'Wyłącz',
            turnOn: 'Włącz',
            unknown: 'Nieznane',
        },
        temperature: {
            units: {
                celsius: '°C',
            },
            alert: {
                degraded: 'Stan czujnika temperatury jest pogorszony.',
                lastReading: 'Ostatni odczyt: {{time}}.',
                noReading: 'Nie otrzymano jeszcze odczytu.',
                offline: 'Czujnik temperatury jest offline{{reason}}',
                realtimeReconnecting:
                    'Strumień czasu rzeczywistego ponownie się łączy. Wyświetlany jest ostatni prawidłowy odczyt temperatury.',
                stale: 'Telemetria temperatury jest nieaktualna. Wyświetlany jest ostatni znany odczyt z {{time}}.',
            },
            current: 'Aktualna temperatura',
        },
    },
} as const;
