/** Shared transport type; every mutation is validated at the server boundary. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FlexibleApi = (path: string, options?: RequestInit) => Promise<any>;
