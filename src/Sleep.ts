/**
 * Delays execution of promise for the duration of seconds.
 *
 * @param seconds
 * @returns
 */
export function sleep(seconds: number) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}