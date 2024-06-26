import * as Request from "request-promise-native";

export function esGet(url: string, settings: object, requestOpts: Partial<Request.Options>, credentials: NetworkCredentials) {
    return networkCall("get", url, settings, requestOpts, credentials);
}

export function esPut(url: string, settings: object, requestOpts: Partial<Request.Options>, credentials: NetworkCredentials) {
    return networkCall("put", url, settings, requestOpts, credentials);
}

export function esPost(url: string, settings: object, requestOpts: Partial<Request.Options>, credentials: NetworkCredentials) {
    return networkCall("post", url, settings, requestOpts, credentials);
}

export interface NetworkCredentials {
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
    service?: string;
    region?: string;
}

export function networkCall(requestFunc: "post" | "put" | "get" | "delete", url: string, settings: object, requestOpts: Partial<Request.Options> = {}, credentials: NetworkCredentials = {}) {
    const headers = {
        "Content-Type": "application/json",
        ...requestOpts.headers
    };
    return Request[requestFunc](url, {
        ...requestOpts,
        headers,
        aws: {
            key: credentials.accessKeyId,
            secret: credentials.secretAccessKey,
            session: credentials.sessionToken,
            sign_version: 4,
            service: "es",
        } as any,
        json: settings
    });
}