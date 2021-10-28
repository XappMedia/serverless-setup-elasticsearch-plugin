import * as Request from "request-promise-native";
const aws4  = require("aws4");

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
    const { headers: requestHeaders, ...remainingOptions } = requestOpts;
    const headers = {
        ...requestHeaders,
        "Content-Type": "application/json",
    };
    const urlObj = new URL(url);
    const { region, service } = credentials;
    const fullRequestOptions = {
        ...remainingOptions,
        headers,
        region,
        service,
        path: urlObj.pathname,
        host: urlObj.host,
    };
    const signedOptions = aws4.sign(fullRequestOptions, credentials);
    return Request[requestFunc](url, {
        ...signedOptions,
        json: settings
    });
}