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
    development: {
        actionCompleted: 'Scenariusz „{{action}}” został ukończony.',
        actionSelected: 'Scenariusz „{{action}}” wybrano dla następnego polecenia LED.',
        closePanel: 'Zamknij panel',
        diagnostics: {
            empty: 'Nie zarejestrowano pominiętych zdarzeń.',
            heading: 'Diagnostyka',
            ignoredEvents: 'Pominięte zdarzenia: {{count}}',
            noDevice: 'brak urządzenia',
            notLoaded: 'nie wczytano',
            refresh: 'Odśwież diagnostykę',
            refreshing: 'Odświeżanie…',
            unknownEvent: 'nieznane zdarzenie',
        },
        loading: 'Wczytywanie scenariuszy programistycznych dla {{deviceId}}…',
        only: 'Tylko w trybie programistycznym',
        panelAriaLabel: 'Scenariusze programistyczne dla {{deviceId}}',
        diagnosticsRequestFailed: 'Nie udało się pobrać diagnostyki.',
        scenarioRequestFailed: 'Żądanie sterowania scenariuszem nie powiodło się.',
        scenariosUnavailable: 'Scenariusze programistyczne są niedostępne dla {{deviceId}}.',
        scenarios: {
            led: {
                actions: {
                    confirmDelayed: 'Potwierdź po 2 sekundach',
                    confirmImmediately: 'Potwierdź natychmiast',
                    degrade: 'Oznacz urządzenie jako pogorszone',
                    disconnect: 'Oznacz urządzenie jako offline',
                    omitConfirmation: 'Pomiń potwierdzenie',
                    reconnect: 'Oznacz urządzenie jako online',
                    recover: 'Przywróć stan urządzenia',
                    reject: 'Odrzuć następne polecenie',
                    reportAfterTimeout: 'Zgłoś po przekroczeniu limitu czasu',
                },
                availability: 'Dostępność',
                commandBehavior: 'Zachowanie polecenia',
                description:
                    'Wybierz zachowanie następnego polecenia LED. Nie zmienia to potwierdzonego stanu LED.',
                health: 'Stan operacyjny',
                title: 'Scenariusze LED',
            },
            temperature: {
                actions: {
                    degrade: 'Pogorsz stan urządzenia',
                    disconnect: 'Oznacz urządzenie jako offline',
                    emitInvalid: 'Wyemituj nieprawidłowy odczyt',
                    emitNext: 'Wyemituj następny odczyt',
                    pause: 'Wstrzymaj telemetrię',
                    reconnect: 'Oznacz urządzenie jako online',
                    recover: 'Przywróć stan urządzenia',
                    replay: 'Odtwórz ostatni odczyt',
                    reset: 'Zresetuj scenariusz',
                    resume: 'Wznów telemetrię',
                },
                availability: 'Dostępność',
                description:
                    'Elementy sterujące obsługują lokalny symulator przez backend. Stan pokoju nadal dociera przez strumień czasu rzeczywistego: bazowy zrzut stanu, a potem aktualizacje urządzeń.',
                freshness: 'Aktualność i telemetria',
                health: 'Stan operacyjny',
                title: 'Scenariusze temperatury',
            },
        },
        telemetryOffline: 'Sterowanie telemetrią jest niedostępne, gdy urządzenie jest offline.',
        trigger: 'Scenariusze programistyczne',
    },
} as const;
