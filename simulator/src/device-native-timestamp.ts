const rfc3339TimestampPattern =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

export function assertValidDeviceNativeTimestamp(timestamp: string, label: string): void {
    const match = rfc3339TimestampPattern.exec(timestamp);

    if (!match || !isValidDateTime(match)) {
        throw new TypeError(`${label} must be an RFC 3339 timestamp with a UTC offset.`);
    }
}

function isValidDateTime(match: RegExpExecArray): boolean {
    const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = match;
    const yearNumber = Number(year);
    const monthNumber = Number(month);
    const dayNumber = Number(day);
    const hourNumber = Number(hour);
    const minuteNumber = Number(minute);
    const secondNumber = Number(second);
    const offsetHourNumber = offsetHour === undefined ? 0 : Number(offsetHour);
    const offsetMinuteNumber = offsetMinute === undefined ? 0 : Number(offsetMinute);

    return (
        monthNumber >= 1 &&
        monthNumber <= 12 &&
        dayNumber >= 1 &&
        dayNumber <= daysInMonth(yearNumber, monthNumber) &&
        hourNumber <= 23 &&
        minuteNumber <= 59 &&
        secondNumber <= 59 &&
        offsetHourNumber <= 23 &&
        offsetMinuteNumber <= 59
    );
}

function daysInMonth(year: number, month: number): number {
    if (month === 2) {
        return isLeapYear(year) ? 29 : 28;
    }

    return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isLeapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
