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
        feed: {
            heading: 'Ostatnie istotne zdarzenia',
            connecting: 'Ładowanie ostatnich zdarzeń…',
            hideSidebar: 'Ukryj ostatnie zdarzenia',
            showSidebar: 'Pokaż ostatnie zdarzenia',
            empty: 'Brak istotnych zdarzeń.',
            lastKnown: 'Strumień łączy się ponownie. Wyświetlane są ostatnio znane zdarzenia.',
            details: 'Szczegóły',
            volatile: 'Nieutrwalone',
            commandId: 'Identyfikator polecenia',
            reason: 'Kod przyczyny',
            failureMessage: 'Opis błędu',
            requestedState: 'Żądany stan',
            requestedBy: 'Zlecone przez',
            target: 'Cel wysłania',
            timeout: 'Limit czasu',
            timeoutMs: '{{count}} ms',
            backfill: 'Odtworzenie obserwacji',
            noBackfill: 'Nie odtworzono obserwacji z czasu przerwy.',
            gapInterval: 'Przerwa od {{from}} do {{to}}.',
            stateReported: 'Urządzenie zgłosiło zasilanie: {{power}}.',
            stateReportedGeneric: 'Urządzenie zgłosiło zmianę stanu.',
            availabilityChanged: 'Dostępność zmieniła się: {{previous}} → {{current}}.',
            healthChanged: 'Stan działania zmienił się: {{previous}} → {{current}}.',
            commandRequested: 'Zażądano zasilania: {{power}}.',
            commandDispatched: 'Polecenie wysłano do źródła urządzenia.',
            commandDeliveryUncertain: 'Nie wiadomo, czy polecenie dotarło do urządzenia.',
            commandFailed: 'Polecenie nie powiodło się.',
            commandTimedOut: 'Nie otrzymano potwierdzenia polecenia w czasie.',
            commandConfirmed: 'Polecenie potwierdzono raportem urządzenia.',
            storageGap: 'Historia ma przerwę po awarii zapisu.',
            availability: {
                online: 'online',
                offline: 'offline',
                unknown: 'nieznana',
            },
            health: {
                healthy: 'prawidłowy',
                degraded: 'pogorszony',
                unknown: 'nieznany',
            },
            requester: {
                user: 'użytkownika',
                automation: 'automatyzację',
            },
            source: {
                'simulator-adapter': 'symulator',
                'hardware-adapter': 'urządzenie sprzętowe',
                backend: 'backend',
            },
        },
        history: {
            room: 'Historia pokoju',
            completeness: 'Historia obejmuje tylko wpisy potwierdzone dostępnymi danymi.',
            lastKnown:
                'Wyświetlana jest ostatnio znana historia. Trwałe dane wymagają odświeżenia.',
            anchor_unavailable:
                'Poprzedni wpis nie jest dostępny w odświeżonej historii. Pokazano najbliższą dostępną pozycję.',
            generation_changed: 'Historia została zastąpiona. Wyświetlane są dane nowej historii.',
            overflow:
                'Część zmian na żywo nie mieści się w pamięci widoku. Powrót do nowych zdarzeń odświeży dostępną trwałą historię.',
            newEvents: 'Nowe zdarzenia',
            loading: 'Ładowanie historii…',
            loadOlder: 'Wczytaj starsze',
            retry: 'Spróbuj ponownie',
            end: 'Koniec dostępnego zakresu historii.',
            powerChanged: 'Zaobserwowano zmianę zasilania: {{previous}} → {{current}}.',
            powerObserved: 'Zaobserwowano zasilanie: {{current}}. Poprzedni stan nie jest znany.',
            availabilityObserved:
                'Zaobserwowano dostępność: {{current}}. Poprzednia dostępność nie jest znana.',
            healthObserved:
                'Zaobserwowano stan działania: {{current}}. Poprzedni stan nie jest znany.',
            failed: 'Próba sterowania nie powiodła się.',
            confirmationMissing:
                'Nie otrzymano potwierdzenia zmiany zasilania na {{power}}. Urządzenie mogło wykonać polecenie.',
            errors: {
                history_unavailable: 'Trwała historia jest chwilowo niedostępna.',
                invalid_response: 'Nie udało się odczytać poprawnej historii.',
                request_failed: 'Nie udało się pobrać historii.',
                recovery_limit:
                    'Nie udało się zakończyć odbudowy historii. Spróbuj odświeżyć widok.',
                cursor_query_mismatch:
                    'Nie udało się kontynuować tego zakresu historii. Spróbuj odświeżyć widok.',
            },
        },
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
